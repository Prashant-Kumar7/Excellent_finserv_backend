import express, { json, urlencoded } from "express";
import cors from "cors";
import dotenv from "dotenv";
import cookieParser from "cookie-parser";
import multer from "multer";

import { apiRouter } from "./routes/api.js";
import { webRouter } from "./routes/web.js";

dotenv.config();

const app = express();
const multipart = multer();

app.use(cors());
app.use(cookieParser());
app.use(json());
app.use(urlencoded({ extended: true }));
// Flutter app posts FormData (multipart) even for text-only requests.
app.use(multipart.any());

app.use("/api", apiRouter);
app.use("/", webRouter);

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Node backend listening on port ${PORT}`);
});

