import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { useApp } from '../AppContext';
import { apiClip, apiTrack, apiTrackBrush, apiTracksForVideo, videoUrl, overlayFrameUrl } from '../api';
import FileBrowser from './FileBrowser';
import { ClipRangeSidebar } from './PlaybackPanel';
import VideoTransport from './VideoTransport';
import VideoStage from './VideoStage';
import Scrubber from './Scrubber';
import ClipTracksList from './ClipTracksList';
import InferencePanel from './InferencePanel';
import ResultArea from './ResultArea';
import FirstMaskModal from '../modals/FirstMaskModal';

const DEFAULT_INFER = {
  sampleFps: 0,
  alpha: 0.45,
  color: '#4facde',
  drawBox: true,
};

/** True if the video element is already playing the full /video?path=… source (not a blob clip). */
function videoElementShowsSourcePath(vid, path) {
  if (!vid || !path) return false;
  const cur = vid.currentSrc || vid.src || '';
  if (!cur || cur.startsWith('blob:')) return false;
  try {
    const u = new URL(cur, window.location.href);
    const q = u.searchParams.get('path');
    if (q == null) return false;
    return q === path || decodeURIComponent(q) === decodeURIComponent(path);
  } catch {
    return cur.includes(encodeURIComponent(path));
  }
}

/** Saved track spans for the scrubber: source-absolute times, or clip-local when viewing a blob clip. */
function scrubberSavedTrackRanges(videoTracks, clipBlob, clipSourceRange) {
  const raw = (videoTracks || [])
    .filter(
      (tr) =>
        tr.clip_start_sec != null &&
        tr.clip_end_sec != null &&
        tr.clip_end_sec > tr.clip_start_sec,
    )
    .map((tr) => ({
      start: tr.clip_start_sec,
      end: tr.clip_end_sec,
      jobId: tr.job_id,
    }));

  if (!clipBlob || !clipSourceRange) return raw;

  const cs = clipSourceRange.start;
  const ce = clipSourceRange.end;
  const span = ce - cs;
  if (!(span > 0)) return [];

  return raw
    .map((seg) => {
      const s = Math.max(seg.start, cs);
      const e = Math.min(seg.end, ce);
      if (e <= s) return null;
      return { start: s - cs, end: e - cs, jobId: seg.jobId };
    })
    .filter(Boolean);
}

export default function TrackPage() {
  const { setCurJob, curJob, toast } = useApp();

  // File / clip state
  const [selPath, setSelPath]               = useState(null);
  const [clipBlob, setClipBlob]             = useState(null);
  const [clipObjUrl, setClipObjUrl]         = useState(null);
  const [clipStartSecs, setClipStartSecs]   = useState(null);  // NEW: for seek-after-approve
  const [clipSourceRange, setClipSourceRange] = useState(null); // { start, end } on full source (manifest)
  const [videoTracks, setVideoTracks]       = useState([]);
  const [currentVideoFilename, setCurrentVideoFilename] = useState('');

  // Playback / stage state
  const [vReady, setVReady]         = useState(false);
  const [videoLoading, setVideoLoading] = useState(false);
  const [stage, setStage]     = useState('video'); // 'video' | 'frame'
  const [mode, setMode]       = useState('draw');  // 'draw' | 'brush' | 'erase' | 'view'
  const [cIn, setCIn]         = useState(null);
  const [cOut, setCOut]       = useState(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration]       = useState(0);
  const [sourceVideoDuration, setSourceVideoDuration] = useState(0);

  // Annotation state (lifted from VideoStage via callbacks)
  const [bbox, setBbox]                 = useState(null);
  const [brushHasContent, setBrushHasContent] = useState(false);

  // Inference config
  const [inferConfig, setInferConfig] = useState(DEFAULT_INFER);
  const [isRunning, setIsRunning]     = useState(false);

  // First-mask modal state (NEW)
  const [showFirstMaskModal, setShowFirstMaskModal] = useState(false);
  const [firstMaskUrl, setFirstMaskUrl]             = useState('');
  const [pendingJobData, setPendingJobData]          = useState(null);

  const videoRef  = useRef(null);
  const stageRef  = useRef(null);

  const loadTracksForPath = useCallback(async (path) => {
    if (!path) {
      setVideoTracks([]);
      return;
    }
    try {
      const data = await apiTracksForVideo(path);
      setVideoTracks(data.tracks || []);
    } catch {
      setVideoTracks([]);
    }
  }, []);

  /** Load [start,end] from source as the working clip blob (same as Extract). */
  const fetchAndLoadClipFromSource = useCallback(async (start, end) => {
    if (!selPath) return;
    if (end <= start) {
      toast('Out point must be after In point', 'warn');
      return;
    }
    const vid = videoRef.current;
    const eps = 0.05;
    const sameRange =
      clipSourceRange &&
      clipBlob &&
      clipObjUrl &&
      Math.abs(clipSourceRange.start - start) < eps &&
      Math.abs(clipSourceRange.end - end) < eps;
    if (sameRange && vid) {
      const isBlob =
        (vid.currentSrc && vid.currentSrc.startsWith('blob:')) ||
        (typeof vid.src === 'string' && vid.src.startsWith('blob:'));
      if (isBlob) {
        vid.currentTime = 0;
        return;
      }
      setVideoLoading(true);
      setVReady(false);
      vid.src = clipObjUrl;
      vid.load();
      const onMeta = () => {
        vid.currentTime = 0;
        vid.removeEventListener('loadedmetadata', onMeta);
      };
      vid.addEventListener('loadedmetadata', onMeta);
      return;
    }

    setClipStartSecs(start);
    setClipSourceRange({ start, end });
    try {
      toast('Loading clip…', 'warn', 15000);
      const blob = await apiClip(selPath, start, end, true);
      const url = URL.createObjectURL(blob);
      setClipBlob(blob);
      if (clipObjUrl) URL.revokeObjectURL(clipObjUrl);
      setClipObjUrl(url);
      if (vid) {
        setVReady(false);
        setVideoLoading(true);
        vid.src = url;
        vid.load();
      }
      setCIn(null);
      setCOut(null);
      setStage('video');
      toast('Clip ready', 'ok');
    } catch (err) {
      toast(`Clip failed: ${err.message}`, 'err');
    }
  }, [selPath, clipObjUrl, clipSourceRange, clipBlob, toast]);

  const handleClipListPendingClick = useCallback(() => {
    if (!clipSourceRange) return;
    fetchAndLoadClipFromSource(clipSourceRange.start, clipSourceRange.end);
  }, [clipSourceRange, fetchAndLoadClipFromSource]);

  const handleClipListTrackClick = useCallback(
    (start, end) => {
      fetchAndLoadClipFromSource(start, end);
    },
    [fetchAndLoadClipFromSource],
  );

  // Keyboard shortcuts
  useEffect(() => {
    function onKey(e) {
      // Don't fire if typing in an input
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;

      switch (e.key) {
        case ' ':
          e.preventDefault();
          if (videoRef.current) {
            videoRef.current.paused
              ? videoRef.current.play()
              : videoRef.current.pause();
          }
          break;
        case 'ArrowLeft':
          e.preventDefault();
          if (videoRef.current) videoRef.current.currentTime -= 0.1;
          break;
        case 'ArrowRight':
          e.preventDefault();
          if (videoRef.current) videoRef.current.currentTime += 0.1;
          break;
        case 'i': case 'I':
          if (videoRef.current) setCIn(videoRef.current.currentTime);
          break;
        case 'o': case 'O':
          if (videoRef.current) setCOut(videoRef.current.currentTime);
          break;
        case 'c': case 'C':
          handleCaptureFrame();
          break;
        case 't': case 'T':
          setStage(s => s === 'video' ? 'frame' : 'video');
          break;
        case 'b': case 'B':
          setMode('brush');
          break;
        case '[':
          stageRef.current && stageRef.current.adjustBrushSize(-4);
          break;
        case ']':
          stageRef.current && stageRef.current.adjustBrushSize(4);
          break;
        case 'Escape':
          if (showFirstMaskModal) {
            handleDiscardMask();
          } else {
            stageRef.current && stageRef.current.clearBox();
          }
          break;
        default:
          break;
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showFirstMaskModal, cIn]);

  // Clean up object URL when clip changes
  useEffect(() => {
    return () => {
      if (clipObjUrl) URL.revokeObjectURL(clipObjUrl);
    };
  }, [clipObjUrl]);

  // When a video file is selected, load it
  const handleSelectFile = useCallback(
    (path) => {
      const vid = videoRef.current;
      const alreadyShowingFullSource =
        path === selPath &&
        vReady &&
        !clipBlob &&
        !clipObjUrl &&
        videoElementShowsSourcePath(vid, path);

      if (alreadyShowingFullSource) {
        loadTracksForPath(path);
        return;
      }

      setSelPath(path);
      setClipBlob(null);
      if (clipObjUrl) URL.revokeObjectURL(clipObjUrl);
      setClipObjUrl(null);
      setClipStartSecs(null);
      setClipSourceRange(null);
      setCIn(null);
      setCOut(null);
      setVReady(false);
      setVideoLoading(true);
      setStage('video');
      setMode('draw');
      setBbox(null);
      setBrushHasContent(false);
      setCurrentVideoFilename(path.split('/').pop());
      if (path !== selPath) {
        setSourceVideoDuration(0);
      }

      if (vid) {
        vid.src = videoUrl(path);
        vid.load();
      }
      loadTracksForPath(path);
    },
    [selPath, vReady, clipBlob, clipObjUrl, loadTracksForPath],
  );

  const handleVideoLoaded = useCallback(() => {
    setVideoLoading(false);
    setVReady(true);
    const d = videoRef.current?.duration || 0;
    setDuration(d);
    const src = videoRef.current?.currentSrc || videoRef.current?.src || '';
    if (!src.startsWith('blob:')) {
      setSourceVideoDuration(d);
    }
  }, []);

  const handleVideoError = useCallback(() => {
    setVideoLoading(false);
    setVReady(false);
    const err = videoRef.current?.error;
    const hint =
      err?.code === 4
        ? 'Format or codec not supported in this browser.'
        : err?.message || 'Could not load video.';
    toast(`Video failed: ${hint}`, 'err');
  }, [toast]);

  const handleTimeUpdate = useCallback(() => {
    setCurrentTime(videoRef.current?.currentTime || 0);
  }, []);

  const scrubSavedRanges = useMemo(
    () => scrubberSavedTrackRanges(videoTracks, !!clipBlob, clipSourceRange),
    [videoTracks, clipBlob, clipSourceRange],
  );

  const scrubberTrackRangeDuration =
    !clipBlob && (duration > 0 || sourceVideoDuration > 0)
      ? sourceVideoDuration || duration
      : undefined;

  const scrubberShowSaved =
    scrubSavedRanges.length > 0 &&
    (!clipBlob ? duration > 0 || sourceVideoDuration > 0 : duration > 0);

  // Extract clip
  const handleExtractClip = useCallback(() => {
    const start = cIn || 0;
    const end = cOut || duration;
    if (end <= start) {
      toast('Out point must be after In point', 'warn');
      return;
    }
    fetchAndLoadClipFromSource(start, end);
  }, [cIn, cOut, duration, fetchAndLoadClipFromSource, toast]);

  // Capture frame
  const handleCaptureFrame = useCallback(async () => {
    if (!stageRef.current) return;
    const ok = stageRef.current.captureFrame();
    if (ok) {
      setStage('frame');
      setMode('draw');
      toast('Frame captured', 'ok', 1500);
    }
  }, []);

  // Run SAM2
  const handleRunSam2 = useCallback(async () => {
    if (!clipBlob) {
      toast('Extract a clip first', 'warn');
      return;
    }

    const isBrush = mode === 'brush' || mode === 'erase';
    const hasBbox = bbox !== null;

    if (!isBrush && !hasBbox) {
      toast('Draw a bounding box or paint a brush mask first', 'warn');
      return;
    }

    setIsRunning(true);
    try {
      const clipMeta =
        selPath && clipSourceRange
          ? {
              sourcePath: selPath,
              clipStartSec: clipSourceRange.start,
              clipEndSec: clipSourceRange.end,
            }
          : {};
      let data;
      if (brushHasContent && stageRef.current) {
        const maskBlob = await stageRef.current.getBrushMaskPng();
        if (!maskBlob) throw new Error('Could not get brush mask');
        // Get frame dimensions from the video
        const vidW = videoRef.current?.videoWidth || 1920;
        const vidH = videoRef.current?.videoHeight || 1080;
        data = await apiTrackBrush(clipBlob, maskBlob, vidW, vidH, inferConfig, clipMeta);
      } else if (hasBbox) {
        const vidW = videoRef.current?.videoWidth || 1920;
        const vidH = videoRef.current?.videoHeight || 1080;
        data = await apiTrack(clipBlob, bbox, vidW, vidH, inferConfig, clipMeta);
      } else {
        throw new Error('No annotation found');
      }

      // Build first-frame overlay URL
      const jobId  = data.job_id;
      const url    = overlayFrameUrl(
        jobId,
        '000000.jpg',
        '000000.png',
        inferConfig.alpha,
        inferConfig.color,
        inferConfig.drawBox
      );

      setPendingJobData(data);
      setFirstMaskUrl(url);
      setShowFirstMaskModal(true);
    } catch (err) {
      toast(`Tracking failed: ${err.message}`, 'err');
    } finally {
      setIsRunning(false);
    }
  }, [clipBlob, bbox, brushHasContent, mode, inferConfig, toast, selPath, clipSourceRange]);

  // Modal: user approves first mask
  const handleApproveMask = useCallback(() => {
    if (!pendingJobData) return;
    const jobId = pendingJobData.job_id;
    setCurJob(jobId);
    setShowFirstMaskModal(false);
    setPendingJobData(null);

    // Reload the original source video and seek to clipStartSecs
    if (videoRef.current && selPath) {
      const vid = videoRef.current;
      setVReady(false);
      setVideoLoading(true);
      vid.src = videoUrl(selPath);
      vid.load();
      const seekOnReady = () => {
        vid.currentTime = clipStartSecs || 0;
        vid.removeEventListener('canplay', seekOnReady);
      };
      vid.addEventListener('canplay', seekOnReady);
    }

    // Revoke clip URL, reset clip state
    if (clipObjUrl) URL.revokeObjectURL(clipObjUrl);
    setClipObjUrl(null);
    setClipBlob(null);
    setStage('video');
    stageRef.current?.clearBrush();
    stageRef.current?.clearBox();
    setClipSourceRange(null);
    if (selPath) loadTracksForPath(selPath);
    toast('Tracking complete! Results saved.', 'ok');
  }, [pendingJobData, setCurJob, selPath, clipStartSecs, clipObjUrl, toast, loadTracksForPath]);

  // Modal: user discards
  const handleDiscardMask = useCallback(() => {
    setShowFirstMaskModal(false);
    setPendingJobData(null);
    setFirstMaskUrl('');
    toast('Discarded. Adjust annotation and try again.', 'warn');
  }, [toast]);

  return (
    <div className="track-page">
      {/* Left column */}
      <div className="track-col">
        <div className="track-col-inner">
          <div className="panel-title">Files</div>
          <FileBrowser
            selPath={selPath}
            onSelectFile={handleSelectFile}
          />
          <div className="divider" />
          <ClipRangeSidebar
            videoRef={videoRef}
            vReady={vReady}
            cIn={cIn}
            cOut={cOut}
            setCIn={setCIn}
            setCOut={setCOut}
            onExtractClip={handleExtractClip}
            clipBlob={clipBlob}
          />
          <div className="divider" />
          <ClipTracksList
            duration={sourceVideoDuration || (!clipBlob ? duration : 0)}
            tracks={videoTracks}
            pendingRange={clipSourceRange}
            currentJobId={curJob}
            hasClipBlob={!!clipBlob}
            onPendingClick={handleClipListPendingClick}
            onTrackClick={handleClipListTrackClick}
          />
        </div>
      </div>

      {/* Center column */}
      <div className="stage-area">
        {/* Mode bar */}
        <div className="mode-bar">
          <button
            className={`mode-btn ${mode === 'draw' ? 'active' : ''}`}
            onClick={() => setMode('draw')}
            title="Draw bounding box"
          >
            Draw Box
          </button>
          <button
            className={`mode-btn ${mode === 'brush' ? 'active' : ''}`}
            onClick={() => setMode('brush')}
            title="Paint brush mask (B)"
          >
            Brush Mask
          </button>
          <button
            className={`mode-btn ${mode === 'erase' ? 'active' : ''}`}
            onClick={() => setMode('erase')}
            title="Erase brush mask"
          >
            Erase
          </button>
          <button
            className={`mode-btn ${mode === 'view' ? 'active' : ''}`}
            onClick={() => setMode('view')}
            title="View only"
          >
            View
          </button>

          <div className="brush-size-indicator">
            <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>
              Stage: <span style={{ color: 'var(--accent)' }}>{stage}</span>
            </span>
          </div>
        </div>

        {/* Video stage */}
        <div className="stage-wrapper">
          <VideoStage
            ref={stageRef}
            videoRef={videoRef}
            mode={mode}
            stage={stage}
            onBboxChange={setBbox}
            onBrushChange={setBrushHasContent}
            onVideoLoaded={handleVideoLoaded}
            onVideoError={handleVideoError}
            onTimeUpdate={handleTimeUpdate}
          />
          {videoLoading && (
            <div className="video-load-overlay" aria-busy="true" aria-live="polite">
              <span className="spinner" />
              <div>
                <div className="video-load-title">Loading video…</div>
                {currentVideoFilename ? (
                  <div className="video-load-label">{currentVideoFilename}</div>
                ) : null}
              </div>
            </div>
          )}
        </div>

        <div className="stage-bottom-stack">
          <VideoTransport
            videoRef={videoRef}
            vReady={vReady}
            currentTime={currentTime}
            duration={duration}
            onCaptureFrame={handleCaptureFrame}
          />
          <Scrubber
            videoRef={videoRef}
            duration={duration}
            trackRangeDuration={scrubberTrackRangeDuration}
            currentTime={currentTime}
            cIn={cIn}
            cOut={cOut}
            onSetIn={setCIn}
            onSetOut={setCOut}
            onSeek={(t) => {
              if (videoRef.current) videoRef.current.currentTime = t;
            }}
            savedTrackRanges={scrubberShowSaved ? scrubSavedRanges : []}
            activeJobId={curJob}
          />
        </div>

        {/* Result area (shows after job is set) */}
        {curJob && (
          <ResultArea
            jobId={curJob}
            inferConfig={inferConfig}
          />
        )}
      </div>

      {/* Right column */}
      <div className="track-col">
        <div className="track-col-inner">
          <InferencePanel
            inferConfig={inferConfig}
            setInferConfig={setInferConfig}
            bbox={bbox}
            brushHasContent={brushHasContent}
            clipBlob={clipBlob}
            isRunning={isRunning}
            onRunSam2={handleRunSam2}
          />
        </div>
      </div>

      {/* FirstMaskModal */}
      {showFirstMaskModal && (
        <FirstMaskModal
          imageUrl={firstMaskUrl}
          onApprove={handleApproveMask}
          onDiscard={handleDiscardMask}
        />
      )}
    </div>
  );
}
