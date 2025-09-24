# sub2fab

Simple CLI program to convert VobSub (DVD subtitles; `.idx` and `.sub`) directly to Adobe Encore-compatible FAB Image Script files (`.txt` with many `.png`s). This is an image-to-image conversion, so there is no loss of data from e.g. OCR.

## Download

This program requires FFmpeg >=7.1 and does not bundle it with its binaries. If you want to pass [video files with embedded VobSub tracks](#extracting-embedded-tracks) directly to sub2fab, mkvextract is also required. You should have `ffmpeg` and `mkvextract` in your path respectively. If they are in a different location, you can [build your own binary](#build).

Download a binary from the [releases tab](https://github.com/shayypy/sub2fab/releases). Below usage examples will use a generic `sub2fab` as the executable name.

### Basic usage (convert a standalone `.idx` and `.sub` pair)

```
./sub2fab subtitle.idx
```

This will automatically look for the corresponding `.sub` file in the same directory with the same filename before the extension (i.e. `subtitle.sub`). This behavior cannot be changed because it is also how FFmpeg looks for the file.

> [!IMPORTANT]
> Due to the way DVD subtitles work, the resolution of the video must be known in order to render accurately. Programs like Subtitle Edit will include a `size:` line in the `.idx` file when possible, but if it is not present then you will need to pass `--size WxH` with the program, replacing `W` and `H` with your video's width and height.

### Extracting embedded tracks (pass a video file, such as `.mkv`)

sub2fab can also extract VobSub tracks using mkvextract and immediately convert them like normal. If your video file is not in Matroska format, FFmpeg will mux it first before passing it to mkvextract.

```
./sub2fab video.mkv
```

If your video has multiple VobSub tracks, you can select a specific one with `--track`:

```
./sub2fab video.mkv --track 4
```

By default, the first VobSub track is chosen. For the `track` parameter, use the ID of the track as given by ffprobe/ffmpeg.

### Extracting subtitles from DVDs

This is not currently supported, but it should be trivial to rip the title yourself and then use sub2fab on the MKV:

```
ffmpeg -f dvdvideo -track 1 -i /dev/dvd -c:s copy -map 0 -map -0:v -map -0:a -map -0:d video.mkv
```

The above will only copy the subtitle tracks, which should be faster. Replace `-track 1` with the title number to rip, according to something like VLC (or any other DVD playback program which tells you the current title). Replace `/dev/dvd` with either the mounted volume, the device address, or an ISO file.

### Output

A file called `Fab_Image_script.txt` and many files named like `IMAGE000.png` will be generated in a `fabscript` folder within the destination directory. Remember to wipe or rename the folder before running the script again with a different subtitle track in the same directory or else you may have residue.

In Adobe Encore, with a timeline open, right click the bottom track area and you should see an "Import Subtitles" option - hover over that and click "Import FAB Images Script", then select the generated text file.

This program does not offer any synchronization functionality such as creating 5-frame gaps for Blu-rays; you will have to do that from within Encore.

## Develop

[Bun](https://bun.com) 1.2.21 or greater is required. Clone the repository and install dependencies with `bun install`. Run the program with `bun src/cli.ts subfile.idx`. `cli.ts` takes the same arguments as the [built binary](#download).

## Build

If you just want to build one binary for your own machine, use `bun run build --outfile sub2fab` to let bun detect the appropriate settings. Otherwise, you can use one of the build scripts:

| Script                | Platform      |
|-----------------------|---------------|
| `bun build:win:x64`   | Windows (x64) |
| `bun build:mac:x64`   | MacOS (x64)   |
| `bun build:mac:arm`   | MacOS (arm64) |
| `bun build:linux:x64` | Linux (x64)   |
| `bun build:linux:arm` | Linux (arm64) |

You can also use `bun build:all` to build binaries for every platform listed above. These binaries are sent to the `dist` directory and are named according to their platform.

### Building with custom FFmpeg and mkvextract paths

Run any of the build scripts with `--define FFMPEG='"/usr/bin/ffmpeg"'` and/or `--define MKVEXTRACT='"/usr/bin/mkvextract"'` to override the hardcoded values, which will by default look for `ffmpeg` and `mkvextract` on your `PATH`. Of course, replace `/usr/bin/...` with the actual path to your binaries for those programs.

## Attribution

- [Subtitle Edit](https://github.com/SubtitleEdit/subtitleedit) by [Nikolaj Olsson](https://www.nikse.dk): a wonderful program I use all the time, but unfortunately it only deals in text subtitles and requires OCR of image-based subtitles before converting to another image-based format. It is the only program I know about that is able to export FAB Image Scripts (other than sub2fab, of course)
- [Thomas Ledoux & Nicolas George](https://ffmpeg.org/pipermail/ffmpeg-user/2024-July/058494.html): jump-start on the strategy I am using to extract each subtitle image as a frame of a video from FFmpeg

### Similar programs

- [BDSup2Sub](https://github.com/mjuhasz/BDSup2Sub) - supports importing & exporting in many image-based formats, but not FAB Image Script.
