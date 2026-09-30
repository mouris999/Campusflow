import React, { useState, useEffect } from 'react';
import {
  Film,
  Upload,
  Play,
  Download,
  Sparkles,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Image as ImageIcon,
  Sliders,
  ChevronRight,
  Layers,
  Camera
} from 'lucide-react';
import { secureWrite } from '../lib/api.js';

const SAMPLE_CAMPUS_IMAGES = [
  {
    title: 'University Central Quad',
    prompt: 'Gentle drone flyover across the sunlit campus quad with autumn leaves swirling and students walking',
    aspectRatio: '16:9',
    svgDataUrl: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="800" height="450" viewBox="0 0 800 450"><defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="%2338bdf8"/><stop offset="100%" stop-color="%23bae6fd"/></linearGradient><linearGradient id="grass" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="%2322c55e"/><stop offset="100%" stop-color="%2315803d"/></linearGradient></defs><rect width="800" height="280" fill="url(%23sky)"/><rect y="260" width="800" height="190" fill="url(%23grass)"/><polygon points="300,260 400,100 500,260" fill="%23475569"/><rect x="340" y="160" width="120" height="100" fill="%2364748b"/><rect x="380" y="210" width="40" height="50" fill="%231e293b"/><circle cx="120" cy="80" r="40" fill="%23facc15"/><text x="400" y="380" font-family="sans-serif" font-size="28" font-weight="bold" fill="white" text-anchor="middle">Metropolitan Central Quad</text></svg>`
  },
  {
    title: 'Central Library Atrium',
    prompt: 'Slow cinematic dolly forward through the grand high-ceiling campus library with ambient warm lighting',
    aspectRatio: '16:9',
    svgDataUrl: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="800" height="450" viewBox="0 0 800 450"><rect width="800" height="450" fill="%231e1b4b"/><rect x="100" y="60" width="600" height="330" fill="%23312e81"/><line x1="200" y1="60" x2="200" y2="390" stroke="%234338ca" stroke-width="8"/><line x1="400" y1="60" x2="400" y2="390" stroke="%234338ca" stroke-width="8"/><line x1="600" y1="60" x2="600" y2="390" stroke="%234338ca" stroke-width="8"/><circle cx="400" cy="180" r="60" fill="%23fbbf24" opacity="0.3"/><text x="400" y="340" font-family="sans-serif" font-size="28" font-weight="bold" fill="%23e0e7ff" text-anchor="middle">Williamson Research Library</text></svg>`
  },
  {
    title: 'Engineering Maker Lab',
    prompt: 'High-tech laboratory workshop with robotic apparatus moving and subtle futuristic blue glow',
    aspectRatio: '16:9',
    svgDataUrl: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="800" height="450" viewBox="0 0 800 450"><rect width="800" height="450" fill="%230f172a"/><circle cx="400" cy="200" r="120" fill="none" stroke="%2338bdf8" stroke-width="4"/><circle cx="400" cy="200" r="60" fill="none" stroke="%230284c7" stroke-width="2"/><line x1="200" y1="200" x2="600" y2="200" stroke="%230ea5e9" stroke-width="2"/><text x="400" y="360" font-family="sans-serif" font-size="26" font-weight="bold" fill="%2338bdf8" text-anchor="middle">Engineering Maker Workshop</text></svg>`
  }
];

const REASSURING_MESSAGES = [
  'Initializing Veo 3.1 Fast video model...',
  'Analyzing photo depth and visual landmarks...',
  'Computing 3D camera trajectory & lighting dynamics...',
  'Generating realistic temporal coherence...',
  'Synthesizing high-definition 720p frames...',
  'Finalizing MP4 video rendering...'
];

export const VeoVideoAnimator: React.FC = () => {
  const [imageBase64, setImageBase64] = useState<string>(SAMPLE_CAMPUS_IMAGES[0].svgDataUrl);
  const [imageMimeType, setImageMimeType] = useState<string>('image/svg+xml');
  const [prompt, setPrompt] = useState<string>(SAMPLE_CAMPUS_IMAGES[0].prompt);
  const [aspectRatio, setAspectRatio] = useState<'16:9' | '9:16'>('16:9');

  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [operationName, setOperationName] = useState<string | null>(null);
  const [pollStatus, setPollStatus] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);

  const [messageIdx, setMessageIdx] = useState<number>(0);

  // Cycle through reassuring messages during video generation
  useEffect(() => {
    let interval: any;
    if (isGenerating) {
      interval = setInterval(() => {
        setMessageIdx(prev => (prev + 1) % REASSURING_MESSAGES.length);
      }, 4000);
    }
    return () => clearInterval(interval);
  }, [isGenerating]);

  // Handle image upload from user file system
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImageMimeType(file.type || 'image/png');
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setImageBase64(reader.result);
        setVideoUrl(null);
        setErrorMessage(null);
      }
    };
    reader.readAsDataURL(file);
  };

  // Convert SVG/Image to raster base64 if needed
  const prepareBase64ForAPI = async (dataUrl: string): Promise<string> => {
    if (dataUrl.startsWith('data:image/svg+xml')) {
      // Rasterize SVG onto canvas for models that require raster PNG
      return new Promise(resolve => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = 800;
          canvas.height = 450;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(img, 0, 0);
            resolve(canvas.toDataURL('image/png'));
          } else {
            resolve(dataUrl);
          }
        };
        img.src = dataUrl;
      });
    }
    return dataUrl;
  };

  const handleStartGeneration = async () => {
    if (!imageBase64 || isGenerating) return;

    setIsGenerating(true);
    setErrorMessage(null);
    setVideoUrl(null);
    setOperationName(null);
    setPollStatus('Submitting generation request to Veo 3.1 Fast...');

    try {
      const cleanDataUrl = await prepareBase64ForAPI(imageBase64);
      const mime = cleanDataUrl.includes('image/png') ? 'image/png' : imageMimeType;

      const res = await secureWrite('/api/generate-video', 'POST', {
        imageBase64: cleanDataUrl,
        mimeType: mime,
        prompt,
        aspectRatio
      });

      const data = await res.json();

      if (!data.success || !data.operationName) {
        throw new Error(data.error || 'Failed to start video generation.');
      }

      setOperationName(data.operationName);
      setPollStatus('Veo processing operation: ' + data.operationName);

      // Start polling loop
      pollVideoStatus(data.operationName);
    } catch (err: any) {
      setIsGenerating(false);
      setErrorMessage(err.message || 'Error occurred starting video generation.');
    }
  };

  const pollVideoStatus = async (opName: string) => {
    let attempts = 0;
    const maxAttempts = 60; // 60 * 5s = 5 minutes max

    const check = async () => {
      attempts++;
      try {
        const statusRes = await secureWrite('/api/video-status', 'POST', {
          operationName: opName
        });

        const statusData = await statusRes.json();

        if (statusData.done) {
          if (statusData.error) {
            throw new Error(statusData.error.message || 'Veo video rendering failed.');
          }

          // Video ready! Build video stream URL
          const streamUrl = `/api/video-stream?operationName=${encodeURIComponent(opName)}`;
          setVideoUrl(streamUrl);
          setIsGenerating(false);
          setPollStatus('Video successfully generated!');
          return;
        }

        if (attempts >= maxAttempts) {
          throw new Error('Video generation timed out. Please retry with a simpler scene.');
        }

        setPollStatus(REASSURING_MESSAGES[attempts % REASSURING_MESSAGES.length]);
        setTimeout(check, 5000);
      } catch (err: any) {
        setIsGenerating(false);
        setErrorMessage(err.message || 'Polling error.');
      }
    };

    setTimeout(check, 4000);
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Studio Header Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-purple-950 to-slate-900 text-white p-6 rounded-2xl border border-slate-800 shadow-md">
        <div className="max-w-2xl">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-purple-500/20 text-purple-300 border border-purple-500/40 mb-3">
            <Film className="w-3.5 h-3.5 text-purple-400" />
            Veo 3.1 Video Generation
          </div>
          <h2 className="text-2xl sm:text-3xl font-black tracking-tight">
            Animate Campus Photos into Cinematic Video
          </h2>
          <p className="mt-2 text-xs sm:text-sm text-slate-300 leading-relaxed">
            Upload any photo or landmark image and transform it into dynamic high-definition video using Google Veo (<code>veo-3.1-fast-generate-preview</code>).
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* LEFT COLUMN (7 Cols): IMAGE UPLOAD & CONTROLS */}
        <div className="lg:col-span-7 space-y-5">
          {/* Image Upload Box */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-slate-900 text-sm flex items-center gap-1.5">
                <ImageIcon className="w-4 h-4 text-purple-600" />
                Step 1: Choose or Upload a Photo
              </h3>
              <label className="cursor-pointer px-3 py-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold text-xs border border-indigo-200 transition-colors flex items-center gap-1.5">
                <Upload className="w-3.5 h-3.5" />
                Upload Photo
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </label>
            </div>

            {/* Current Image Preview */}
            <div className={`relative rounded-xl border border-slate-200 bg-slate-950 overflow-hidden flex items-center justify-center ${
              aspectRatio === '9:16' ? 'aspect-[9/16] max-h-[380px] mx-auto' : 'aspect-[16/9]'
            }`}>
              {imageBase64 ? (
                <img
                  src={imageBase64}
                  alt="Preview"
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="text-center p-6 text-slate-500 text-xs">
                  <Upload className="w-8 h-8 mx-auto mb-2 text-slate-400" />
                  <p>Click "Upload Photo" above or pick a campus preset below</p>
                </div>
              )}
            </div>

            {/* Sample Presets */}
            <div className="space-y-1.5">
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                Or Pick a Campus Landmark Preset:
              </span>
              <div className="grid grid-cols-3 gap-2">
                {SAMPLE_CAMPUS_IMAGES.map((sample, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => {
                      setImageBase64(sample.svgDataUrl);
                      setImageMimeType('image/svg+xml');
                      setPrompt(sample.prompt);
                      setVideoUrl(null);
                      setErrorMessage(null);
                    }}
                    className="p-2 rounded-lg border border-slate-200 hover:border-purple-400 hover:bg-purple-50/50 text-left transition-colors text-xs"
                  >
                    <div className="font-bold text-slate-800 truncate">{sample.title}</div>
                    <div className="text-[10px] text-slate-400">16:9 Preset</div>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Configuration Controls */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4">
            <h3 className="font-bold text-slate-900 text-sm flex items-center gap-1.5">
              <Sliders className="w-4 h-4 text-purple-600" />
              Step 2: Video Configuration
            </h3>

            {/* Aspect Ratio Selector (16:9 Landscape vs 9:16 Portrait as requested) */}
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                Target Aspect Ratio (Veo Specification)
              </label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setAspectRatio('16:9')}
                  className={`p-3 rounded-xl border text-left flex items-center justify-between transition-all ${
                    aspectRatio === '16:9'
                      ? 'border-purple-600 bg-purple-50 text-purple-900 font-bold ring-2 ring-purple-500/20'
                      : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                  }`}
                >
                  <div>
                    <div className="text-xs">16:9 Landscape</div>
                    <div className="text-[10px] text-slate-400 font-normal">Desktop & Presentation</div>
                  </div>
                  <span className="text-xs font-mono font-bold">16:9</span>
                </button>

                <button
                  type="button"
                  onClick={() => setAspectRatio('9:16')}
                  className={`p-3 rounded-xl border text-left flex items-center justify-between transition-all ${
                    aspectRatio === '9:16'
                      ? 'border-purple-600 bg-purple-50 text-purple-900 font-bold ring-2 ring-purple-500/20'
                      : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                  }`}
                >
                  <div>
                    <div className="text-xs">9:16 Portrait</div>
                    <div className="text-[10px] text-slate-400 font-normal">Mobile Story & Reel</div>
                  </div>
                  <span className="text-xs font-mono font-bold">9:16</span>
                </button>
              </div>
            </div>

            {/* Animation Motion Prompt */}
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                Motion &amp; Camera Direction Prompt
              </label>
              <textarea
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
                rows={2}
                placeholder="Describe how the camera should move and what changes occur in the scene..."
                className="w-full p-2.5 text-xs rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-purple-500 font-sans"
              />
              <p className="text-[11px] text-slate-400 mt-1">
                Model: <strong className="font-mono text-purple-700">veo-3.1-fast-generate-preview</strong> (720p HD)
              </p>
            </div>

            {/* Error Message */}
            {errorMessage && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-xs flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-600" />
                <span>{errorMessage}</span>
              </div>
            )}

            {/* Generate Action Button */}
            <button
              onClick={handleStartGeneration}
              disabled={isGenerating || !imageBase64}
              className="w-full py-3 px-4 rounded-xl font-black text-sm bg-gradient-to-r from-purple-600 to-indigo-600 text-white hover:from-purple-700 hover:to-indigo-700 disabled:opacity-50 shadow-md transition-all active:scale-[0.99] flex items-center justify-center gap-2"
            >
              {isGenerating ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Generating Veo Video...
                </>
              ) : (
                <>
                  <Film className="w-4 h-4" />
                  Generate Video with Veo ({aspectRatio})
                </>
              )}
            </button>
          </div>
        </div>

        {/* RIGHT COLUMN (5 Cols): GENERATED VIDEO SCREEN & STATUS */}
        <div className="lg:col-span-5 space-y-5">
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4 h-full flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between pb-3 border-b border-slate-200">
                <h3 className="font-bold text-slate-900 text-sm flex items-center gap-1.5">
                  <Film className="w-4 h-4 text-purple-600" />
                  Veo Video Output
                </h3>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-100 text-purple-800">
                  {aspectRatio}
                </span>
              </div>

              {/* VIDEO VIEWER OR GENERATION PROGRESS */}
              <div className="mt-4">
                {videoUrl ? (
                  <div className="space-y-4">
                    <div className={`rounded-xl overflow-hidden border border-slate-800 bg-black shadow-lg ${
                      aspectRatio === '9:16' ? 'aspect-[9/16] max-h-[420px] mx-auto' : 'aspect-[16/9]'
                    }`}>
                      <video
                        src={videoUrl}
                        controls
                        autoPlay
                        loop
                        playsInline
                        className="w-full h-full object-cover"
                      />
                    </div>

                    <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs space-y-1">
                      <div className="font-bold text-emerald-900 flex items-center gap-1.5">
                        <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                        Veo Generation Complete!
                      </div>
                      <p className="text-emerald-800 text-[11px]">
                        Video generated with model <code>veo-3.1-fast-generate-preview</code> at {aspectRatio}.
                      </p>
                    </div>

                    <a
                      href={videoUrl}
                      download={`campus-veo-video-${Date.now()}.mp4`}
                      className="w-full py-2.5 px-4 rounded-xl font-bold text-xs bg-slate-900 text-white hover:bg-slate-800 transition-colors shadow flex items-center justify-center gap-2"
                    >
                      <Download className="w-4 h-4" />
                      Download MP4 Video
                    </a>
                  </div>
                ) : isGenerating ? (
                  /* Reassuring In-Progress Loading Screen */
                  <div className="bg-slate-950 text-white rounded-xl p-8 text-center space-y-5 border border-slate-800 min-h-[300px] flex flex-col items-center justify-center">
                    <div className="relative">
                      <div className="w-16 h-16 rounded-full border-4 border-purple-500/20 border-t-purple-500 animate-spin" />
                      <Film className="w-7 h-7 text-purple-400 absolute inset-0 m-auto" />
                    </div>

                    <div className="space-y-2 max-w-xs">
                      <h4 className="font-bold text-sm text-purple-300">
                        {REASSURING_MESSAGES[messageIdx]}
                      </h4>
                      <p className="text-[11px] text-slate-400 leading-relaxed">
                        Veo video generation typically takes 1 to 2 minutes. Please keep this screen open while frames are synthesized.
                      </p>
                    </div>

                    {operationName && (
                      <div className="text-[10px] text-slate-500 font-mono truncate max-w-[220px]">
                        Op: {operationName}
                      </div>
                    )}
                  </div>
                ) : (
                  /* Idle Empty State */
                  <div className="bg-slate-50 rounded-xl border border-dashed border-slate-200 p-10 text-center text-slate-400 space-y-2">
                    <Camera className="w-10 h-10 mx-auto text-slate-300" />
                    <p className="font-semibold text-xs text-slate-600">No Video Generated Yet</p>
                    <p className="text-[11px] max-w-xs mx-auto">
                      Select or upload an image and click "Generate Video with Veo" to start.
                    </p>
                  </div>
                )}
              </div>
            </div>

            <div className="text-[11px] text-slate-400 bg-slate-50 p-3 rounded-xl border border-slate-200 mt-4 leading-relaxed">
              💡 <strong>Model Specification:</strong> Uses <code>veo-3.1-fast-generate-preview</code> with 16:9 landscape or 9:16 portrait ratio. Supports photo-to-video cinematic animation.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
