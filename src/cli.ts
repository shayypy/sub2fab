import { ArgumentParser } from "argparse";
import { version } from "../package.json";
import { extractSubs, processIdx } from "./process";

const parser = new ArgumentParser({
  description: "Convert dvd subtitles to Adobe Encore image scripts",
});

parser.add_argument("file", {
  nargs: 1,
  help: "the idx or video file to parse",
});
parser.add_argument("-v", "--version", { action: "version", version });
parser.add_argument("--size", {
  help: "for idx files without a size value: specify video size (WxH)",
});
parser.add_argument("--track", {
  help: "for video files: specify a stream (by index) to extract",
  type: Number,
});

const parsed = parser.parse_args();
const filename = parsed.file[0] as string;

const file = Bun.file(filename);
let path: string | undefined;
if (file.type.startsWith("video/")) {
  path = await extractSubs(filename, parsed.track);
} else if (filename.toLowerCase().endsWith(".idx")) {
  path = filename;
} else if (filename.toLowerCase().endsWith(".sub")) {
  throw Error(
    "Please pass a video or .idx file, not a .sub file. Plaintext .sub files are not supported.",
  );
} else {
  throw Error(
    "Unrecognized file format provided. Please use a video or .idx file.",
  );
}

const outPath = await processIdx(path, { size: parsed.size });
console.log(outPath);
