import { fetchMasterData } from "../backend/master-data-client.js";
import { analyzeImage } from "../ai/ai-client.js";
import { ServiceError } from "../errors.js";

const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function readBearerToken(value) {
  if (typeof value !== "string") return null;
  const match = /^Bearer\s+(\S+)$/i.exec(value);
  return match?.[1] ? value : null;
}

async function readUpload(request) {
  if (!request.isMultipart()) {
    throw new ServiceError(415, "MULTIPART_REQUIRED", "Send the image as multipart form data.");
  }

  let image = null;
  let mimeType = null;
  let documentType = null;
  let locale = null;

  for await (const part of request.parts()) {
    if (part.type === "file") {
      if (part.fieldname !== "image" || image) {
        throw new ServiceError(400, "INVALID_UPLOAD", "Provide exactly one file in the image field.");
      }
      if (!ALLOWED_MIME_TYPES.has(part.mimetype)) {
        throw new ServiceError(415, "UNSUPPORTED_IMAGE", "Supported image types are JPEG, PNG, and WebP.");
      }
      image = await part.toBuffer();
      mimeType = part.mimetype;
    } else if (part.fieldname === "documentType") {
      documentType = String(part.value).slice(0, 40);
    } else if (part.fieldname === "locale") {
      locale = String(part.value).slice(0, 35);
    } else {
      throw new ServiceError(400, "UNSUPPORTED_FIELD", "The request contains an unsupported field.");
    }
  }

  if (!image?.length) {
    throw new ServiceError(400, "IMAGE_REQUIRED", "An image file is required.");
  }

  return { image, mimeType, documentType, locale };
}

export async function analyzeRoute(app, { config, fetchImpl }) {
  app.post("/v1/ocr/analyze", async (request) => {
    const authorization = readBearerToken(request.headers.authorization);
    if (!authorization) {
      throw new ServiceError(401, "UNAUTHORIZED", "A valid Bearer access token is required.");
    }

    const upload = await readUpload(request);
    const masterData = await fetchMasterData({ authorization, config, fetchImpl });
    const result = await analyzeImage({ ...upload, ...masterData, config, fetchImpl });
    return result;
  });
}