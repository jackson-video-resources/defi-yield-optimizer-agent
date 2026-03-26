import * as ort from "onnxruntime-node";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODELS_DIR = path.resolve(__dirname, "../../../models");

const sessionCache = new Map<string, ort.InferenceSession>();

export async function loadModel(name: string): Promise<ort.InferenceSession> {
  if (sessionCache.has(name)) return sessionCache.get(name)!;
  const modelPath = path.join(MODELS_DIR, name);
  if (!fs.existsSync(modelPath)) {
    throw new Error(`Model not found: ${modelPath}`);
  }
  const session = await ort.InferenceSession.create(modelPath);
  sessionCache.set(name, session);
  return session;
}

export async function runInference(
  session: ort.InferenceSession,
  input: Float32Array,
  inputName = "float_input",
): Promise<Float32Array> {
  const tensor = new ort.Tensor("float32", input, [1, input.length]);
  const feeds = { [inputName]: tensor };
  const results = await session.run(feeds);
  const output = Object.values(results)[0];
  return output.data as Float32Array;
}
