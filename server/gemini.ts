import { Router } from 'express';
import type { GenerateVideosOperation, GoogleGenAI } from '@google/genai';

export const geminiRouter = Router();

/**
 * `@google/genai` is loaded lazily, never at module scope.
 *
 * It and its transitive dependencies (`@grpc/grpc-js` and friends) total roughly
 * 14 MB of mixed ESM/CommonJS. Importing it statically put all of that into the
 * serverless function's startup path, so every cold start paid to parse code
 * that a request to `/api/health` never uses, and the bundle was the largest
 * thing in the deploy.
 *
 * Nothing here needs the SDK until a Gemini or Veo route is actually called, so
 * it is imported on first use and then cached for the life of the instance. The
 * `import type` above is erased at build time and costs nothing.
 */
type GenAIModule = typeof import('@google/genai');

let genaiModule: Promise<GenAIModule> | null = null;

/** Loads and caches the SDK. Concurrent first calls share one import. */
function loadGenAI(): Promise<GenAIModule> {
  if (!genaiModule) {
    genaiModule = import('@google/genai').catch((error: unknown) => {
      // Clear the cache so a transient failure does not poison every later call.
      genaiModule = null;
      throw error;
    });
  }
  return genaiModule;
}

/**
 * Builds a Gemini client, or null when no API key is configured.
 *
 * Async because the SDK is loaded on demand. Returns null for the missing-key
 * case exactly as before; a genuine load failure rejects, so the route reports
 * it rather than pretending the feature is merely unconfigured.
 */
async function getGeminiClient(): Promise<GoogleGenAI | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return null;
  }
  const { GoogleGenAI } = await loadGenAI();
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

/**
 * Rebuilds a `GenerateVideosOperation` from its name, for the polling routes.
 * The SDK is only touched when a caller actually polls a video job.
 */
async function videosOperationFrom(name: string): Promise<GenerateVideosOperation> {
  const { GenerateVideosOperation } = await loadGenAI();
  const op = new GenerateVideosOperation();
  op.name = name;
  return op;
}

const DEFAULT_SYSTEM_INSTRUCTION = `You are CampusFlow AI, the official intelligent assistant for Galgotias University, Greater Noida.
You help students, faculty, and campus visitors navigate services, virtual queues, operating hours, and university facilities.
Your knowledge includes:
- Administrative Offices: Student Records & Registrar (Main Admin Bld Floor 1), North Annex Registrar (North Pavilion - lower wait!), Bursar & Financial Aid (Main Admin Floor 2).
- Canteens & Dining: Student Union Central Canteen (peak lunch rush 11:30-13:30), Engineering Pavilion Cafe & Deli (fast grab-and-go with low wait).
- Laboratories: Chemistry & Biology Central Store (dispensing glassware/reagents, PPE required), Engineering Maker Lab & Workshop (oscilloscopes, 3D printing).
- Libraries: Central Library (circulation desk, course reserves 2-hour loan, study room keys).
- IT Support: Student Union Suite 205 (wifi setup, eduroam, laptop diagnostics, MFA reset).
- Virtual Queue Rules: Students can join remotely from anywhere on campus, receive dynamic ticket numbers (e.g. REG-103), receive alert when #2 in line, and have a 5-minute grace period when called to check in at the counter.
Being honest about the map: the campus is real Galgotias University, drawn from OpenStreetMap survey data. Building names above are CampusFlow service locations projected onto the real campus until an administrator confirms the surveyed building. Only B-Block, C-Block, School of Hospitality, Sports Ground and BasketBall Ground have surveyed positions. Never invent a building name, a room number, or a distance - say it is not recorded instead.
Always be welcoming, structured, concise, and helpful. Use bullet points for steps or required documents.`;

// MULTI-TURN CHAT ENDPOINT
geminiRouter.post('/chat', async (req, res) => {
  try {
    const ai = await getGeminiClient();
    if (!ai) {
      return res.status(500).json({
        success: false,
        error: 'GEMINI_API_KEY is not configured on the server. Please check your environment variables.'
      });
    }

    const { messages, model, systemInstruction } = req.body;
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Messages array is required.'
      });
    }

    // Select model as requested by user prompt:
    // 'gemini-3.5-flash' for general tasks (default)
    // 'gemini-3.1-pro-preview' for complex tasks
    // 'gemini-3.1-flash-lite' for fast tasks
    const validModels = ['gemini-3.5-flash', 'gemini-3.1-pro-preview', 'gemini-3.1-flash-lite'];
    const chosenModel = validModels.includes(model) ? model : 'gemini-3.5-flash';

    // Format contents into @google/genai format
    const contents = messages.map((m: { role: string; text: string }) => ({
      role: m.role === 'assistant' || m.role === 'model' ? 'model' : 'user',
      parts: [{ text: m.text }]
    }));

    const response = await ai.models.generateContent({
      model: chosenModel,
      contents,
      config: {
        systemInstruction: systemInstruction || DEFAULT_SYSTEM_INSTRUCTION,
        temperature: 0.7,
      }
    });

    const replyText = response.text || 'I apologize, but I could not formulate a response. Please try rephrasing your question.';

    res.json({
      success: true,
      text: replyText,
      modelUsed: chosenModel
    });
  } catch (error: any) {
    console.error('Gemini chat error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'An error occurred while communicating with Gemini.'
    });
  }
});

// VEO VIDEO GENERATION: ANIMATE IMAGES INTO VIDEO
geminiRouter.post('/generate-video', async (req, res) => {
  try {
    const ai = await getGeminiClient();
    if (!ai) {
      return res.status(500).json({
        success: false,
        error: 'GEMINI_API_KEY is not configured on the server.'
      });
    }

    const { imageBase64, mimeType, prompt, aspectRatio } = req.body;
    if (!imageBase64) {
      return res.status(400).json({
        success: false,
        error: 'imageBase64 is required to animate an image into video.'
      });
    }

    // Strip data URL prefix if present e.g. "data:image/png;base64,..."
    const cleanBase64 = imageBase64.includes(',') ? imageBase64.split(',')[1] : imageBase64;
    const cleanMime = mimeType || 'image/png';
    const targetAspectRatio = aspectRatio === '9:16' ? '9:16' : '16:9';

    // Use veo-3.1-fast-generate-preview as requested in feature prompt
    const operation = await ai.models.generateVideos({
      model: 'veo-3.1-fast-generate-preview',
      prompt: prompt || 'A cinematic, smooth camera motion animating this scene with subtle natural life and lighting',
      image: {
        imageBytes: cleanBase64,
        mimeType: cleanMime
      },
      config: {
        numberOfVideos: 1,
        resolution: '720p',
        aspectRatio: targetAspectRatio
      }
    });

    res.json({
      success: true,
      operationName: operation.name,
      aspectRatio: targetAspectRatio
    });
  } catch (error: any) {
    console.error('Veo video generation error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to start video generation with Veo.'
    });
  }
});

// VEO STATUS POLLING ENDPOINT
geminiRouter.post('/video-status', async (req, res) => {
  try {
    const ai = await getGeminiClient();
    if (!ai) {
      return res.status(500).json({ success: false, error: 'GEMINI_API_KEY is not configured.' });
    }

    const { operationName } = req.body;
    if (!operationName) {
      return res.status(400).json({ success: false, error: 'operationName is required.' });
    }

    const op = await videosOperationFrom(operationName);
    const updated = await ai.operations.getVideosOperation({ operation: op });

    const hasVideo = !!updated.response?.generatedVideos?.[0]?.video?.uri;

    res.json({
      success: true,
      done: !!updated.done,
      hasVideo,
      error: updated.error || null
    });
  } catch (error: any) {
    console.error('Veo status check error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to check video generation status.'
    });
  }
});

// VEO VIDEO STREAM / DOWNLOAD ENDPOINT
geminiRouter.get('/video-stream', async (req, res) => {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).send('GEMINI_API_KEY not configured.');
    }

    const ai = await getGeminiClient();
    if (!ai) {
      return res.status(500).send('Gemini client unavailable.');
    }

    const operationName = req.query.operationName as string;
    if (!operationName) {
      return res.status(400).send('operationName is required.');
    }

    const op = await videosOperationFrom(operationName);
    const updated = await ai.operations.getVideosOperation({ operation: op });

    const uri = updated.response?.generatedVideos?.[0]?.video?.uri;
    if (!uri) {
      return res.status(404).send('Video not yet ready or URI not available.');
    }

    // Fetch binary video from Google storage using the API key
    const videoRes = await fetch(uri, {
      headers: { 'x-goog-api-key': apiKey }
    });

    if (!videoRes.ok) {
      return res.status(videoRes.status).send(`Failed to fetch video: ${videoRes.statusText}`);
    }

    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Cache-Control', 'public, max-age=86400');

    // Pipe response arrayBuffer to Express res
    const arrayBuffer = await videoRes.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    res.send(buffer);
  } catch (error: any) {
    console.error('Veo video download stream error:', error);
    res.status(500).send(error.message || 'Failed to download video.');
  }
});
