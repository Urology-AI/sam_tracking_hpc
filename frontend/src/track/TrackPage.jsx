import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useApp } from '../AppContext';
import { apiClip, apiTrack, apiTrackBrush, videoUrl, overlayFrameUrl } from '../api';
import FileBrowser from './FileBrowser';
import PlaybackPanel from './PlaybackPanel';
import VideoStage from './VideoStage';
import Scrubber from './Scrubber';
import InferencePanel from './InferencePanel';
import ResultArea from './ResultArea';
import FirstMaskModal from '../modals/FirstMaskModal';

const DEFAULT_INFER = {
  sampleFps: 0,
  alpha: 0.45,
  color: '#4facde',
  drawBox: true,
};

export default function TrackPage() {
  const { setCurJob, curJob, toast } = useApp();

  // File / clip state
  const [selPath, setSelPath]               = useState(null);
  const [clipBlob, setClipBlob]             = useState(null);
  const [clipObjUrl, setClipObjUrl]         = useState(null);
  const [clipStartSecs, setClipStartSecs]   = useState(null);  // NEW: for seek-after-approve
  const [currentVideoFilename, setCurrentVideoFilename] = useState('');

  // Playback / stage state
  const [vReady, setVReady]   = useState(false);
  const [stage, setStage]     = useState('video'); // 'video' | 'frame'
  const [mode, setMode]       = useState('draw');  // 'draw' | 'brush' | 'erase' | 'view'
  const [cIn, setCIn]         = useState(null);
  const [cOut, setCOut]       = useState(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration]       = useState(0);

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
  const handleSelectFile = useCallback((path) => {
    setSelPath(path);
    setClipBlob(null);
    if (clipObjUrl) URL.revokeObjectURL(clipObjUrl);
    setClipObjUrl(null);
    setClipStartSecs(null);
    setCIn(null);
    setCOut(null);
    setVReady(false);
    setStage('video');
    setMode('draw');
    setBbox(null);
    setBrushHasContent(false);
    setCurrentVideoFilename(path.split('/').pop());

    if (videoRef.current) {
      videoRef.current.src = videoUrl(path);
      videoRef.current.load();
    }
  }, [clipObjUrl]);

  const handleVideoLoaded = useCallback(() => {
    setVReady(true);
    setDuration(videoRef.current?.duration || 0);
  }, []);

  const handleTimeUpdate = useCallback(() => {
    setCurrentTime(videoRef.current?.currentTime || 0);
  }, []);

  // Extract clip
  const handleExtractClip = useCallback(async () => {
    if (!selPath) return;
    const start = cIn || 0;
    const end   = cOut || duration;
    if (end <= start) {
      toast('Out point must be after In point', 'warn');
      return;
    }

    // Save clip start for seek-after-approve
    setClipStartSecs(start);

    try {
      toast('Extracting clip…', 'warn', 15000);
      const blob = await apiClip(selPath, start, end, true);
      const url  = URL.createObjectURL(blob);
      setClipBlob(blob);
      if (clipObjUrl) URL.revokeObjectURL(clipObjUrl);
      setClipObjUrl(url);

      // Load clip into video element
      if (videoRef.current) {
        videoRef.current.src = url;
        videoRef.current.load();
      }
      setCIn(null);
      setCOut(null);
      setStage('video');
      toast('Clip ready', 'ok');
    } catch (err) {
      toast(`Clip failed: ${err.message}`, 'err');
    }
  }, [selPath, cIn, cOut, duration, clipObjUrl, toast]);

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
      let data;
      if (brushHasContent && stageRef.current) {
        const maskBlob = await stageRef.current.getBrushMaskPng();
        if (!maskBlob) throw new Error('Could not get brush mask');
        // Get frame dimensions from the video
        const vidW = videoRef.current?.videoWidth || 1920;
        const vidH = videoRef.current?.videoHeight || 1080;
        data = await apiTrackBrush(clipBlob, maskBlob, vidW, vidH, inferConfig);
      } else if (hasBbox) {
        const vidW = videoRef.current?.videoWidth || 1920;
        const vidH = videoRef.current?.videoHeight || 1080;
        data = await apiTrack(clipBlob, bbox, vidW, vidH, inferConfig);
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
  }, [clipBlob, bbox, brushHasContent, mode, inferConfig, toast]);

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
    toast('Tracking complete! Results saved.', 'ok');
  }, [pendingJobData, setCurJob, selPath, clipStartSecs, clipObjUrl, toast]);

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
          <div className="panel-title">Playback</div>
          <PlaybackPanel
            videoRef={videoRef}
            vReady={vReady}
            currentTime={currentTime}
            duration={duration}
            cIn={cIn}
            cOut={cOut}
            setCIn={setCIn}
            setCOut={setCOut}
            onExtractClip={handleExtractClip}
            onCaptureFrame={handleCaptureFrame}
            clipBlob={clipBlob}
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
            onTimeUpdate={handleTimeUpdate}
          />
        </div>

        {/* Scrubber */}
        <Scrubber
          videoRef={videoRef}
          duration={duration}
          currentTime={currentTime}
          cIn={cIn}
          cOut={cOut}
          onSetIn={setCIn}
          onSetOut={setCOut}
          onSeek={(t) => {
            if (videoRef.current) videoRef.current.currentTime = t;
          }}
        />

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
