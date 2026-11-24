import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import express, { type Request, type Response } from "express";
import { GoogleGenAI, Type } from "@google/genai";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const PYTHON_PORT = Number(process.env.PYTHON_PORT || 8000);
const IS_PROD = process.env.NODE_ENV === "production";

let pythonProc: ChildProcess | null = null;
let pythonBootPromise: Promise<void> | null = null;

function checkPythonHealth(): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: PYTHON_PORT,
        path: "/api/py/health",
        method: "GET",
        timeout: 1000,
      },
      (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      }
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
}

async function ensurePythonBackend(): Promise<void> {
  if (await checkPythonHealth()) {
    return;
  }
  if (pythonBootPromise) {
    return pythonBootPromise;
  }

  pythonBootPromise = (async () => {
    const pyScript = path.resolve(__dirname, "backend/app.py");
    if (!pythonProc || pythonProc.killed) {
      pythonProc = spawn("python3", [pyScript], {
        env: {
          ...process.env,
          PYTHON_PORT: String(PYTHON_PORT),
        },
        stdio: ["ignore", "pipe", "pipe"],
      });

      pythonProc.stdout?.on("data", (chunk: Buffer) => {
        process.stdout.write(`[py] ${chunk.toString()}`);
      });
      pythonProc.stderr?.on("data", (chunk: Buffer) => {
        process.stderr.write(`[py] ${chunk.toString()}`);
      });
      pythonProc.on("exit", (code) => {
        if (code !== null && code !== 0) {
          console.error(`Python backend exited with code ${code}`);
        }
        pythonProc = null;
      });
    }

    for (let i = 0; i < 40; i++) {
      if (await checkPythonHealth()) {
        return;
      }
      await new Promise((r) => setTimeout(r, 150));
    }
    throw new Error("Timed out waiting for Python backend on port " + PYTHON_PORT);
  })();

  try {
    await pythonBootPromise;
  } finally {
    pythonBootPromise = null;
  }
}

function proxyToPython(req: Request, res: Response): void {
  const method = req.method.toUpperCase();
  const hasBody = method !== "GET" && method !== "HEAD" && req.body !== undefined;
  const bodyStr = hasBody ? JSON.stringify(req.body) : "";

  const headers: Record<string, string | number> = {};
  if (hasBody) {
    headers["Content-Type"] = "application/json";
    headers["Content-Length"] = Buffer.byteLength(bodyStr);
  }

  const pyReq = http.request(
    {
      hostname: "127.0.0.1",
      port: PYTHON_PORT,
      path: req.originalUrl,
      method,
      headers,
      timeout: 15000,
    },
    (pyRes) => {
      res.status(pyRes.statusCode || 500);
      const contentType = pyRes.headers["content-type"];
      if (contentType) {
        res.setHeader("Content-Type", contentType);
      }
      const disposition = pyRes.headers["content-disposition"];
      if (disposition) {
        res.setHeader("Content-Disposition", disposition);
      }
      pyRes.pipe(res);
    }
  );

  pyReq.on("error", (err) => {
    if (!res.headersSent) {
      res.status(502).json({ error: err.message || "Python backend unavailable" });
    }
  });
  pyReq.on("timeout", () => {
    pyReq.destroy();
    if (!res.headersSent) {
      res.status(504).json({ error: "Python backend request timed out" });
    }
  });

  if (hasBody) {
    pyReq.write(bodyStr);
  }
  pyReq.end();
}

function shutdownPython(): void {
  if (pythonProc && !pythonProc.killed) {
    pythonProc.kill("SIGTERM");
    pythonProc = null;
  }
}

process.on("SIGINT", () => {
  shutdownPython();
  process.exit(0);
});
process.on("SIGTERM", () => {
  shutdownPython();
  process.exit(0);
});
process.on("exit", shutdownPython);

async function startServer(): Promise<void> {
  // Start Python backend immediately in background
  void ensurePythonBackend().catch((err) => {
    console.error("Initial Python boot warning:", err);
  });

  const app = express();
  app.use(express.json({ limit: "10mb" }));

  // Proxy all /api/py/* traffic to Python 3.11 SQLite backend
  app.use("/api/py", async (req: Request, res: Response) => {
    try {
      await ensurePythonBackend();
      proxyToPython(req, res);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Python backend proxy error";
      res.status(502).json({ error: msg });
    }
  });

  // Optional Gemini Vision biomedical waste classification endpoint
  app.post("/api/ai/classify-image", async (req: Request, res: Response) => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey === "MY_GEMINI_API_KEY") {
      res.status(503).json({
        error:
          "GEMINI_API_KEY is not configured in Secrets. Use Python Smart Classifier or add a Gemini API key in Settings > Secrets.",
      });
      return;
    }

    const { image_base64, mime_type, notes } = req.body as {
      image_base64?: string;
      mime_type?: string;
      notes?: string;
    };

    if (!image_base64) {
      res.status(400).json({ error: "image_base64 is required for Gemini Vision analysis." });
      return;
    }

    try {
      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: { headers: { "User-Agent": "aistudio-build" } },
      });

      const cleanBase64 = image_base64.includes(",") ? image_base64.split(",")[1] : image_base64;
      const response = await ai.models.generateContent({
        model: "gemini-4-hydrogen",
        contents: {
          parts: [
            {
              inlineData: {
                mimeType: mime_type || "image/jpeg",
                data: cleanBase64,
              },
            },
            {
              text:
                `Classify this biomedical waste item according to CPCB India Biomedical Waste Management Rules 2016 into one of: yellow (Infectious/Anatomical/Soiled dressings), red (Contaminated Recyclable Plastics/Tubing/Gloves), white (Sharps/Needles/Scalpels), blue (Glassware/Ampoules/Metallic Implants). Additional context: ${notes || "None"}.`,
            },
          ],
        },
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              item_name: { type: Type.STRING },
              category: { type: Type.STRING },
              confidence: { type: Type.NUMBER },
              reasoning: { type: Type.STRING },
            },
            required: ["item_name", "category", "confidence", "reasoning"],
          },
        },
      });

      const parsed = JSON.parse((response.text ?? "{}").trim());
      res.json(parsed);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Gemini Vision classification failed";
      res.status(500).json({ error: msg });
    }
  });

  if (!IS_PROD) {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, "dist");
    if (fs.existsSync(distDir)) {
      app.use(express.static(distDir));
      app.get("*", (_req, res) => {
        res.sendFile(path.join(distDir, "index.html"));
      });
    }
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`MediTrack server listening on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
  shutdownPython();
  process.exit(1);
});
