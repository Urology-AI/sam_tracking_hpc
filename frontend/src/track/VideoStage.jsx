import React, {
  forwardRef,
  useImperativeHandle,
  useRef,
  useEffect,
  useCallback,
  useState,
} from 'react';

const MAX_UNDO = 30;

function getScale(containerW, containerH, fW, fH) {
  if (!fW || !fH) return { sc: 1, iW: containerW, iH: containerH, iOx: 0, iOy: 0 };
  const sc  = Math.min(containerW / fW, containerH / fH);
  const iW  = fW * sc;
  const iH  = fH * sc;
  const iOx = (containerW - iW) / 2;
  const iOy = (containerH - iH) / 2;
  return { sc, iW, iH, iOx, iOy };
}

const VideoStage = forwardRef(function VideoStage(
  { videoRef, mode, stage, onBboxChange, onBrushChange, onVideoLoaded, onVideoError, onTimeUpdate },
  ref
) {
  const containerRef    = useRef(null);
  const frameCanvasRef  = useRef(null);
  const brushCanvasRef  = useRef(null);
  const cursorCanvasRef = useRef(null);

  // Snapshot of the captured frame background (offscreen canvas, display size)
  const capturedFrameRef = useRef(null);

  // Offscreen brush buffer at full image resolution
  const brushBufRef  = useRef(null);
  const undoStackRef = useRef([]);

  // Captured frame dimensions (image coords)
  const fWRef = useRef(0);
  const fHRef = useRef(0);

  // Box drawing state
  const boxStartRef = useRef(null);
  const bboxRef     = useRef(null);

  // Brush state
  const brushSizeRef  = useRef(20);
  const isDrawingRef  = useRef(false);
  const lastBrushRef  = useRef(null);
  const [, setBrushSize] = useState(20); // only for forcing cursor re-renders

  // ── Utility: compute display scale from current container size ─────────
  const getDisplayScale = useCallback(() => {
    const cont = containerRef.current;
    if (!cont) return { sc: 1, iW: 0, iH: 0, iOx: 0, iOy: 0 };
    return getScale(cont.clientWidth, cont.clientHeight, fWRef.current, fHRef.current);
  }, []);

  // ── Render frame canvas: background image + bbox ───────────────────────
  const renderFrame = useCallback(() => {
    const fc   = frameCanvasRef.current;
    const cont = containerRef.current;
    if (!fc || !cont || !fWRef.current) return;

    fc.width  = cont.clientWidth;
    fc.height = cont.clientHeight;

    const ctx               = fc.getContext('2d');
    const { sc, iOx, iOy } = getDisplayScale();

    ctx.clearRect(0, 0, fc.width, fc.height);

    // Draw captured frame background
    if (capturedFrameRef.current) {
      ctx.drawImage(capturedFrameRef.current, 0, 0, fc.width, fc.height);
    }

    // Draw bbox overlay
    if (bboxRef.current) {
      const b  = bboxRef.current;
      const dx = iOx + b.x1 * sc;
      const dy = iOy + b.y1 * sc;
      const dw = (b.x2 - b.x1) * sc;
      const dh = (b.y2 - b.y1) * sc;

      ctx.strokeStyle = '#4facde';
      ctx.lineWidth   = 2;
      ctx.setLineDash([]);
      ctx.strokeRect(dx, dy, dw, dh);

      const hs = 6;
      ctx.fillStyle = '#4facde';
      [[dx, dy], [dx + dw, dy], [dx, dy + dh], [dx + dw, dy + dh]].forEach(([cx, cy]) => {
        ctx.fillRect(cx - hs / 2, cy - hs / 2, hs, hs);
      });
    }
  }, [getDisplayScale]);

  // ── Sync brushCanvas display from brushBuf ─────────────────────────────
  const syncBrushDisplay = useCallback(() => {
    const bc   = brushCanvasRef.current;
    const buf  = brushBufRef.current;
    const cont = containerRef.current;
    if (!bc || !buf || !cont) return;

    bc.width  = cont.clientWidth;
    bc.height = cont.clientHeight;

    const ctx              = bc.getContext('2d');
    const { iW, iH, iOx, iOy } = getDisplayScale();
    ctx.clearRect(0, 0, bc.width, bc.height);
    ctx.drawImage(buf, iOx, iOy, iW, iH);
  }, [getDisplayScale]);

  // ── captureFrame ───────────────────────────────────────────────────────
  const captureFrame = useCallback(() => {
    const vid = videoRef.current;
    const fc  = frameCanvasRef.current;
    const cont = containerRef.current;
    if (!vid || !fc || !cont) return false;

    const fW = vid.videoWidth;
    const fH = vid.videoHeight;
    if (!fW || !fH) return false;

    fWRef.current = fW;
    fHRef.current = fH;

    fc.width  = cont.clientWidth;
    fc.height = cont.clientHeight;

    const { iW, iH, iOx, iOy } = getDisplayScale();
    const ctx = fc.getContext('2d');
    ctx.clearRect(0, 0, fc.width, fc.height);
    ctx.drawImage(vid, iOx, iOy, iW, iH);

    // Save background snapshot for bbox re-draws
    if (!capturedFrameRef.current) {
      capturedFrameRef.current = document.createElement('canvas');
    }
    capturedFrameRef.current.width  = fc.width;
    capturedFrameRef.current.height = fc.height;
    capturedFrameRef.current.getContext('2d').drawImage(fc, 0, 0);

    // Init brushBuf at full image resolution
    if (!brushBufRef.current) {
      brushBufRef.current = document.createElement('canvas');
    }
    brushBufRef.current.width  = fW;
    brushBufRef.current.height = fH;
    brushBufRef.current.getContext('2d').clearRect(0, 0, fW, fH);
    undoStackRef.current = [];

    return true;
  }, [videoRef, getDisplayScale]);

  // ── getBrushMaskPng ────────────────────────────────────────────────────
  const getBrushMaskPng = useCallback(() => {
    return new Promise((resolve) => {
      const buf = brushBufRef.current;
      if (!buf) return resolve(null);

      const tmpCanvas  = document.createElement('canvas');
      tmpCanvas.width  = buf.width;
      tmpCanvas.height = buf.height;
      const tmpCtx     = tmpCanvas.getContext('2d');

      const srcCtx  = buf.getContext('2d');
      const imgData = srcCtx.getImageData(0, 0, buf.width, buf.height);
      const data    = imgData.data;
      const outData = tmpCtx.createImageData(buf.width, buf.height);
      const out     = outData.data;

      for (let i = 0; i < data.length; i += 4) {
        const val  = data[i + 3] > 10 ? 255 : 0;
        out[i]     = val;
        out[i + 1] = val;
        out[i + 2] = val;
        out[i + 3] = 255;
      }
      tmpCtx.putImageData(outData, 0, 0);
      tmpCanvas.toBlob(resolve, 'image/png');
    });
  }, []);

  // ── clearBrush ─────────────────────────────────────────────────────────
  const clearBrush = useCallback(() => {
    const buf = brushBufRef.current;
    if (buf) buf.getContext('2d').clearRect(0, 0, buf.width, buf.height);
    const bc = brushCanvasRef.current;
    if (bc)  bc.getContext('2d').clearRect(0, 0, bc.width, bc.height);
    undoStackRef.current = [];
    onBrushChange(false);
  }, [onBrushChange]);

  // ── clearBox ───────────────────────────────────────────────────────────
  const clearBox = useCallback(() => {
    bboxRef.current = null;
    onBboxChange(null);
    renderFrame();
  }, [onBboxChange, renderFrame]);

  // ── adjustBrushSize ────────────────────────────────────────────────────
  const adjustBrushSize = useCallback((delta) => {
    brushSizeRef.current = Math.max(2, Math.min(200, brushSizeRef.current + delta));
    setBrushSize(brushSizeRef.current);
  }, []);

  // ── undo ───────────────────────────────────────────────────────────────
  const undo = useCallback(() => {
    const stack = undoStackRef.current;
    if (!stack.length) return;
    const snapshot = stack.pop();
    const buf = brushBufRef.current;
    if (!buf) return;
    buf.getContext('2d').putImageData(snapshot, 0, 0);
    syncBrushDisplay();
    const data       = buf.getContext('2d').getImageData(0, 0, buf.width, buf.height).data;
    const hasContent = Array.from(data).some((v, i) => i % 4 === 3 && v > 10);
    onBrushChange(hasContent);
  }, [syncBrushDisplay, onBrushChange]);

  // ── Expose methods via ref ─────────────────────────────────────────────
  useImperativeHandle(ref, () => ({
    captureFrame,
    getBrushMaskPng,
    clearBrush,
    clearBox,
    adjustBrushSize,
    undo,
  }), [captureFrame, getBrushMaskPng, clearBrush, clearBox, adjustBrushSize, undo]);

  // ── Push undo snapshot ─────────────────────────────────────────────────
  const pushUndo = useCallback(() => {
    const buf = brushBufRef.current;
    if (!buf) return;
    const stack    = undoStackRef.current;
    const snapshot = buf.getContext('2d').getImageData(0, 0, buf.width, buf.height);
    stack.push(snapshot);
    if (stack.length > MAX_UNDO) stack.shift();
  }, []);

  // ── Draw brush stroke into brushBuf ────────────────────────────────────
  const drawBrushStroke = useCallback((x, y, erase) => {
    const buf = brushBufRef.current;
    if (!buf) return;

    const ctx  = buf.getContext('2d');
    const size = brushSizeRef.current;
    ctx.globalCompositeOperation = erase ? 'destination-out' : 'source-over';
    ctx.fillStyle = 'rgba(79,172,222,0.8)';

    if (lastBrushRef.current) {
      const { x: lx, y: ly } = lastBrushRef.current;
      const dist  = Math.hypot(x - lx, y - ly);
      const steps = Math.max(1, Math.ceil(dist / (size * 0.25)));
      for (let i = 0; i <= steps; i++) {
        const t  = i / steps;
        const px = lx + (x - lx) * t;
        const py = ly + (y - ly) * t;
        ctx.beginPath();
        ctx.arc(px, py, size / 2, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      ctx.beginPath();
      ctx.arc(x, y, size / 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    lastBrushRef.current = { x, y };
    syncBrushDisplay();
  }, [syncBrushDisplay]);

  // ── Cursor canvas ──────────────────────────────────────────────────────
  const renderCursor = useCallback((clientX, clientY) => {
    const cc   = cursorCanvasRef.current;
    const cont = containerRef.current;
    if (!cc || !cont) return;

    cc.width  = cont.clientWidth;
    cc.height = cont.clientHeight;

    const rect     = cont.getBoundingClientRect();
    const cx       = clientX - rect.left;
    const cy       = clientY - rect.top;
    const { sc }   = getDisplayScale();
    const r        = (brushSizeRef.current / 2) * sc;

    const ctx = cc.getContext('2d');
    ctx.clearRect(0, 0, cc.width, cc.height);
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth   = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, Math.max(1, r), 0, Math.PI * 2);
    ctx.stroke();
  }, [getDisplayScale]);

  const clearCursor = useCallback(() => {
    const cc = cursorCanvasRef.current;
    if (cc) cc.getContext('2d').clearRect(0, 0, cc.width, cc.height);
  }, []);

  // ── Convert client coords → image coords ──────────────────────────────
  const clientToImage = useCallback((clientX, clientY) => {
    const cont = containerRef.current;
    if (!cont) return { x: 0, y: 0 };
    const rect           = cont.getBoundingClientRect();
    const { sc, iOx, iOy } = getDisplayScale();
    return {
      x: (clientX - rect.left - iOx) / sc,
      y: (clientY - rect.top  - iOy) / sc,
    };
  }, [getDisplayScale]);

  // ── Box drawing handlers (frameCanvas) ────────────────────────────────
  const handleFrameMouseDown = useCallback((e) => {
    if (mode !== 'draw' || stage !== 'frame') return;
    e.preventDefault();
    const { x, y } = clientToImage(e.clientX, e.clientY);
    boxStartRef.current = { x, y };
  }, [mode, stage, clientToImage]);

  const handleFrameMouseMove = useCallback((e) => {
    if (mode !== 'draw' || stage !== 'frame' || !boxStartRef.current) return;
    const { x, y } = clientToImage(e.clientX, e.clientY);
    const s = boxStartRef.current;
    const b = {
      x1: Math.min(s.x, x), y1: Math.min(s.y, y),
      x2: Math.max(s.x, x), y2: Math.max(s.y, y),
    };
    bboxRef.current = b;

    const fc  = frameCanvasRef.current;
    const cont = containerRef.current;
    if (!fc || !cont) return;

    const ctx              = fc.getContext('2d');
    const { sc, iOx, iOy } = getDisplayScale();
    ctx.clearRect(0, 0, fc.width, fc.height);

    if (capturedFrameRef.current) {
      ctx.drawImage(capturedFrameRef.current, 0, 0, fc.width, fc.height);
    }

    const dx = iOx + b.x1 * sc;
    const dy = iOy + b.y1 * sc;
    const dw = (b.x2 - b.x1) * sc;
    const dh = (b.y2 - b.y1) * sc;
    ctx.strokeStyle = '#4facde';
    ctx.lineWidth   = 2;
    ctx.setLineDash([6, 3]);
    ctx.strokeRect(dx, dy, dw, dh);
    ctx.setLineDash([]);
  }, [mode, stage, clientToImage, getDisplayScale]);

  const handleFrameMouseUp = useCallback((e) => {
    if (!boxStartRef.current) return;
    const { x, y } = clientToImage(e.clientX, e.clientY);
    const s = boxStartRef.current;
    boxStartRef.current = null;

    const b = {
      x1: Math.min(s.x, x), y1: Math.min(s.y, y),
      x2: Math.max(s.x, x), y2: Math.max(s.y, y),
    };
    if (Math.abs(b.x2 - b.x1) < 4 || Math.abs(b.y2 - b.y1) < 4) return;

    b.x1 = Math.max(0, Math.round(b.x1));
    b.y1 = Math.max(0, Math.round(b.y1));
    b.x2 = Math.min(fWRef.current, Math.round(b.x2));
    b.y2 = Math.min(fHRef.current, Math.round(b.y2));

    bboxRef.current = b;
    onBboxChange(b);
    renderFrame();
  }, [clientToImage, onBboxChange, renderFrame]);

  // ── Brush drawing handlers (brushCanvas) ──────────────────────────────
  const handleBrushMouseDown = useCallback((e) => {
    if (mode !== 'brush' && mode !== 'erase') return;
    e.preventDefault();
    pushUndo();
    isDrawingRef.current = true;
    lastBrushRef.current = null;
    const { x, y } = clientToImage(e.clientX, e.clientY);
    drawBrushStroke(x, y, mode === 'erase');
    onBrushChange(true);
  }, [mode, clientToImage, drawBrushStroke, pushUndo, onBrushChange]);

  // Document-level handlers for drag-outside-canvas
  useEffect(() => {
    function onDocMouseMove(e) {
      if (!isDrawingRef.current) return;
      if (mode !== 'brush' && mode !== 'erase') return;
      renderCursor(e.clientX, e.clientY);
      const { x, y } = clientToImage(e.clientX, e.clientY);
      drawBrushStroke(x, y, mode === 'erase');
    }
    function onDocMouseUp() {
      if (isDrawingRef.current) {
        isDrawingRef.current = false;
        lastBrushRef.current = null;
      }
    }
    document.addEventListener('mousemove', onDocMouseMove);
    document.addEventListener('mouseup', onDocMouseUp);
    return () => {
      document.removeEventListener('mousemove', onDocMouseMove);
      document.removeEventListener('mouseup', onDocMouseUp);
    };
  }, [mode, clientToImage, drawBrushStroke, renderCursor]);

  const handleBrushMouseMove  = useCallback((e) => {
    if (mode === 'brush' || mode === 'erase') renderCursor(e.clientX, e.clientY);
  }, [mode, renderCursor]);

  const handleBrushMouseLeave = useCallback(() => clearCursor(), [clearCursor]);

  const handleBrushMouseEnter = useCallback((e) => {
    if (mode === 'brush' || mode === 'erase') renderCursor(e.clientX, e.clientY);
  }, [mode, renderCursor]);

  // ── Pointer-events routing ─────────────────────────────────────────────
  const framePointer = (stage === 'frame' && mode === 'draw') ? 'auto' : 'none';
  const brushPointer = (mode === 'brush' || mode === 'erase') ? 'auto' : 'none';

  // ── Re-draw on resize ──────────────────────────────────────────────────
  useEffect(() => {
    const cont = containerRef.current;
    if (!cont) return;
    const obs = new ResizeObserver(() => {
      if (stage === 'frame' && fWRef.current) {
        renderFrame();
        syncBrushDisplay();
      }
    });
    obs.observe(cont);
    return () => obs.disconnect();
  }, [stage, renderFrame, syncBrushDisplay]);

  // Re-draw when mode/stage changes
  useEffect(() => {
    if (stage === 'frame' && fWRef.current) {
      renderFrame();
      syncBrushDisplay();
    }
  }, [stage, mode, renderFrame, syncBrushDisplay]);

  return (
    <div className="video-stage" ref={containerRef}>
      {/* Video element */}
      <video
        ref={videoRef}
        style={{
          zIndex: 1,
          display: stage === 'video' ? 'block' : 'none',
          objectFit: 'contain',
        }}
        preload="auto"
        onLoadedMetadata={onVideoLoaded}
        onError={onVideoError}
        onTimeUpdate={onTimeUpdate}
        playsInline
        controls={false}
      />

      {/* Frame canvas: captured frame + bbox overlay */}
      <canvas
        className="frame-canvas"
        ref={frameCanvasRef}
        style={{
          display: stage === 'frame' ? 'block' : 'none',
          pointerEvents: framePointer,
          cursor: mode === 'draw' ? 'crosshair' : 'default',
        }}
        onMouseDown={handleFrameMouseDown}
        onMouseMove={handleFrameMouseMove}
        onMouseUp={handleFrameMouseUp}
      />

      {/* Brush canvas: scaled composite of brushBuf */}
      <canvas
        className="brush-canvas"
        ref={brushCanvasRef}
        style={{
          display: stage === 'frame' ? 'block' : 'none',
          pointerEvents: brushPointer,
          opacity: 0.72,
          cursor: 'none',
        }}
        onMouseDown={handleBrushMouseDown}
        onMouseMove={handleBrushMouseMove}
        onMouseLeave={handleBrushMouseLeave}
        onMouseEnter={handleBrushMouseEnter}
      />

      {/* Cursor canvas: brush ring, pointer-events: none always */}
      <canvas
        className="cursor-canvas"
        ref={cursorCanvasRef}
        style={{
          display: (mode === 'brush' || mode === 'erase') ? 'block' : 'none',
        }}
      />
    </div>
  );
});

export default VideoStage;
