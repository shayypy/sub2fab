import path from "node:path";
import { $ } from "bun";

declare const FFMPEG: string;
declare const FFPROBE: string;
declare const MKVEXTRACT: string;

let paths: Record<"ffmpeg" | "ffprobe" | "mkvextract", string>;
try {
  paths = {
    ffmpeg: FFMPEG,
    ffprobe: FFPROBE,
    mkvextract: MKVEXTRACT,
  };
} catch {
  paths = {
    ffmpeg: "ffmpeg",
    ffprobe: "ffprobe",
    mkvextract: "mkvextract",
  };
}

interface IdxParagraph {
  startTime: number;
  filePosition: number;
}

const parseTimestamp = (
  hours = 0,
  minutes = 0,
  seconds = 0,
  milliseconds = 0,
): number => {
  let val = 0;
  // const [hours, minutes, seconds, milliseconds] = value.split(":").map(Number);

  if (hours && !Number.isNaN(hours)) val += hours * 3_600_000;
  if (minutes && !Number.isNaN(minutes)) val += minutes * 60_000;
  if (seconds && !Number.isNaN(seconds)) val += seconds * 1_000;
  if (milliseconds && !Number.isNaN(milliseconds)) val += milliseconds;

  return val;
};

const secToTimestamp = (seconds: number, delimiter = ":"): string => {
  const date = new Date(seconds * 1000);
  const result = date.toISOString().slice(11, 23);
  return result.replace(".", ":").replaceAll(/:/g, delimiter);
};

// This class is a partial port of https://github.com/SubtitleEdit/subtitleedit/blob/main/src/libse/VobSub/Idx.cs
class Idx {
  private static readonly TIMECODE_LINE_RE =
    /^timestamp: (\d+:\d+:\d+:\d+), filepos: ([\dabcdefABCDEF]+)?$/m;

  public readonly paragraphs: IdxParagraph[] = [];
  public readonly palette: number[] = [];
  public readonly languages: string[] = [];
  public size: string | undefined;

  constructor(lines: string[]) {
    let languageIndex = 0;
    for (const line of lines) {
      const tclMatch = Idx.TIMECODE_LINE_RE.exec(line);
      if (tclMatch?.[1] && tclMatch[2]) {
        const paragraph = Idx.getTimecodeAndFilePosition(
          tclMatch[1],
          tclMatch[2],
        );
        if (paragraph) {
          this.paragraphs.push(paragraph);
        }
      } else if (line.startsWith("size:") && line.length > 7) {
        this.size = line.replace("size:", "").trim();
      } else if (line.startsWith("palette:") && line.length > 10) {
        const s = line.replace("palette:", "");
        const colors = s.split(/[, ]/g).filter(Boolean);
        for (const hex of colors) {
          this.palette.push(Idx.hexToColor(hex));
        }
      } else if (line.startsWith("id:") && line.length > 4) {
        const parts = line.split(/[:, ]/g).filter(Boolean);
        if (parts.length > 1) {
          const langId = parts[1];
          if (parts.length > 3 && parts[2] === "index") {
            if (validNum(parts[3])) {
              languageIndex = Number(parts[3]);
            }
          }
          this.languages.push(`${langId} \x200E(0x${languageIndex + 32})`);
          languageIndex += 1;
        }
      }
    }
  }

  static hexToColor(hex: string) {
    hex = hex.replace(/^#/, "").trim();
    if (hex.length === 6) {
      return parseInt(hex, 16);
    } else if (hex.length === 8) {
      return parseInt(hex.substring(2), 16);
    }
    return 0;
  }

  static getTimecodeAndFilePosition(
    timestamp: string,
    filepos: string,
  ): IdxParagraph | null {
    // timestamp: 00:00:01:401, filepos: 000000000
    const tsParts = timestamp.split(":");
    if (
      validNum(tsParts[0]) &&
      validNum(tsParts[1]) &&
      validNum(tsParts[2]) &&
      validNum(tsParts[3])
    ) {
      return {
        startTime: parseTimestamp(
          Number(tsParts[0]),
          Number(tsParts[1]),
          Number(tsParts[2]),
          Number(tsParts[3]),
        ),
        filePosition: parseInt(filepos.trim(), 16),
      };
    }
    return null;
  }
}

const validNum = (value: string | undefined): value is string => {
  return value !== undefined && !Number.isNaN(Number(value));
};

/**
 *
 * @param filename path to the `.idx` file for the subtitle pair
 * @param options.size the resolution of the video (WxH) that these subtitles are for
 * @returns the path to the resultant `.txt` file
 */
export const processIdx = async (
  filename: string,
  options?: {
    size?: string;
  },
) => {
  const dir = path.resolve(filename, "..");
  const content = await Bun.file(filename).text();
  const lines = content.split("\n");
  const idx = new Idx(lines);

  const size = options?.size ?? idx.size;
  if (!size) {
    throw Error(
      "Video size is required to accurately render subtitles. Please add a `size:` line to the source `.idx` file or specify the size with `--size 1920x1080`.",
    );
  }

  // In theory we could make this something like 10 for easier math but I was
  // encountering issues with duplicated/skipped entries when trying that. We
  // might need to use a real value.
  const fps = 30;
  // const duration =

  // We're going to create a new `idx` file with one subtitle at each frame,
  // then use ffmpeg to extract all the frames from a pseudo-video that has
  // the subtitle burned in. This is a bit of a hacky solution (I would have
  // preferred to just read the .sub file), but I just couldn't figure it out.

  const newIdx = [
    "# VobSub index file, v7 (do not modify this line!)",
    `size: ${size}`,
    `palette: ${idx.palette.map((pal) => pal.toString(16).padStart(6, "0")).join(", ")}`,
    "langidx: 0",
    "id: en, index: 0",
    ...idx.paragraphs.map((paragraph, i) => {
      // we offset index by 1 because ffmpeg seems to not render subs until
      // the second frame
      const ts = (1 / fps) * (i + 1);
      return `timestamp: ${secToTimestamp(ts)}, filepos: ${paragraph.filePosition.toString(16).padStart(9, "0")}`;
    }),
  ].join("\n");
  await Bun.write(`${filename}.rw.idx`, newIdx);
  await $`cp ${filename.replace(".idx", ".sub")} ${filename}.rw.sub`;

  // Thanks to Thomas Ledoux & Nicolas George on the ffmpeg-user mailing list
  // for a bit of a jumpstart on this strategy:
  // https://ffmpeg.org/pipermail/ffmpeg-user/2024-July/058494.html

  await $`mkdir -p ${path.join(dir, "fabscript")}`;

  // one paragraph per frame means the duration is equal to the number of
  // paragraphs multiplied by the duration of one frame (1/30 of a second
  // for 30fps). add one (and minimum of 1s) for insurance. also keep in
  // mind that the first frame is skipped.
  const duration = Math.max(idx.paragraphs.length * (1 / fps), 0) + 1;
  await $`${paths.ffmpeg} -f lavfi -i color=size=${size}:duration=${Math.ceil(duration)}:rate=${fps}:color=black@0.0,format=rgba -i ${filename}.rw.idx -filter_complex "[0:v][1:s]overlay[v]" -map "[v]" -f image2 -frame_pts true -c:s png -vsync 0 -frames:v ${idx.paragraphs.length + 1} ${path.join(dir, "fabscript", "IMAGE%03d.png")} -y`.quiet();
  await $`rm ${filename}.rw.idx ${filename}.rw.sub ${path.join(dir, "fabscript", "IMAGE000.png")}`;

  const [width, height] = size.split("x");
  const out = path.join(dir, "fabscript", "Fab_Image_script.txt");
  await Bun.write(
    out,
    idx.paragraphs
      .map((paragraph, i) => {
        // I don't know how to correctly determine subtitle duration
        // currently, so we're making a guess and avoiding overlaps.
        const nextStartTime = idx.paragraphs[i + 1]?.startTime;
        const maxDuration = 6000;
        let nextTs = secToTimestamp(
          (nextStartTime !== undefined
            ? Math.min(paragraph.startTime + maxDuration, nextStartTime - 500)
            : paragraph.startTime + maxDuration) / 1000,
          ";",
        );

        return `IMAGE${(i + 1).toString().padStart(3, "0")}.png ${secToTimestamp(paragraph.startTime / 1000, ";")} ${nextTs} 0 0 ${width} ${height}`;
      })
      .join("\n"),
  );

  return out;
};

interface FFProbeStream {
  index: number;
  codec_name: string;
  codec_type: string;
  tags?: { language: string };
}

/**
 * Use mkvextract to extract an `.idx` and `.sub` pair from a video.
 * @param filename path to a video file with embedded dvd_subtitle tracks
 * @param track the stream ID to use (defaults to first compatible)
 * @returns the path to the resultant `.idx` file
 */
export const extractSubs = async (
  filename: string,
  track?: number,
): Promise<string> => {
  const { exitCode } = await $`${paths.mkvextract} -h`.quiet().nothrow();
  if (exitCode !== 0) {
    throw Error(
      "mkvextract was not found. You can specify your own path to it when building, see README.",
    );
  }

  const probe =
    (await $`${paths.ffprobe} -v quiet -of json -show_streams ${filename}`.json()) as {
      streams: FFProbeStream[];
    };
  const stream =
    track !== undefined
      ? probe.streams.find((s) => s.index === track)
      : probe.streams.find((s) => s.codec_name === "dvd_subtitle");
  if (track !== undefined && !stream) {
    throw Error(`There was no stream at index ${track}.`);
  } else if (
    track !== undefined &&
    stream &&
    stream.codec_name !== "dvd_subtitle"
  ) {
    throw Error(`There was no dvd_subtitle stream at index ${track}.`);
  } else if (!stream) {
    throw Error("The video has no dvd_subtitle tracks.");
  }

  const file = Bun.file(filename);
  let muxed = false;
  let mkv = new Blob();
  if (file.type !== "video/x-matroska") {
    console.log(
      `Video is not a matroska, muxing the desired stream (${stream.index})`,
    );
    await $`${paths.ffmpeg} -i ${file} -c:s copy -map 0:s:${stream.index} -f matroska ${mkv}`.quiet();
    muxed = true;
  } else {
    mkv = file;
  }

  const idxOut = `${filename.split(".").slice(0, -1)}.${stream.tags?.language ?? stream.index}.idx`;
  // According to the help page, this is incorrect usage, but the documented
  // examples seem to be errant
  // TODO: is the stream ID kept for the muxed file?
  await $`${paths.mkvextract} tracks ${mkv} ${muxed ? 0 : stream.index}:${idxOut}`;

  return idxOut;
};
