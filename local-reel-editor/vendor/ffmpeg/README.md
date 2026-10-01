Put platform FFmpeg builds here before `npm run dist` to ship them inside the app:

    vendor/ffmpeg/mac/ffmpeg, vendor/ffmpeg/mac/ffprobe
    vendor/ffmpeg/win/ffmpeg.exe, vendor/ffmpeg/win/ffprobe.exe
    vendor/ffmpeg/linux/ffmpeg, vendor/ffmpeg/linux/ffprobe

They are copied to `resources/bin`, which the app checks first. If the folder
is empty, the app falls back to FFmpeg on PATH or a path chosen in "Компоненты".
Use LGPL/GPL builds according to your distribution needs.
