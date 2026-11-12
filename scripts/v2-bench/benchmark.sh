#!/usr/bin/env bash
# DIF-V2-WO-002 benchmark harness.
#
# Runs a disposable, synthetic 120 s 9:16 episode assembly on a host with
# FFmpeg/ffprobe available. It never touches production services, never uses
# sudo, and removes only its own BENCH_ROOT.
#
# Usage:
#   BENCH_ROOT=$HOME/v2-bench ./benchmark.sh inventory
#   BENCH_ROOT=$HOME/v2-bench ./benchmark.sh generate
#   BENCH_ROOT=$HOME/v2-bench ./benchmark.sh render run1 1080 1920
#   BENCH_ROOT=$HOME/v2-bench ./benchmark.sh render run720 720 1280
#   BENCH_ROOT=$HOME/v2-bench ./benchmark.sh validate run1 1080 1920
#   BENCH_ROOT=$HOME/v2-bench ./benchmark.sh failures
#   BENCH_ROOT=$HOME/v2-bench ./benchmark.sh summary
#   BENCH_ROOT=$HOME/v2-bench ./benchmark.sh health
#   BENCH_ROOT=$HOME/v2-bench ./benchmark.sh cleanup
#
# FFMPEG/FFPROBE default to $BENCH_ROOT/ffmpeg/{ffmpeg,ffprobe}.
set -Eeuo pipefail

export LC_ALL=C
export TZ=UTC

BENCH_ROOT=${BENCH_ROOT:-$HOME/v2-bench}
FFMPEG=${FFMPEG:-$BENCH_ROOT/ffmpeg/ffmpeg}
FFPROBE=${FFPROBE:-$BENCH_ROOT/ffmpeg/ffprobe}
INPUTS="$BENCH_ROOT/inputs"
RUNS="$BENCH_ROOT/runs"
LOGS="$BENCH_ROOT/logs"
CLIPS="$INPUTS/clips"
AUDIO="$INPUTS/audio"
CONCAT="$INPUTS/concat.txt"
DURATION=120
FPS=30
PRESET=veryfast
CRF=21

mkdir -p "$RUNS" "$LOGS"

log() {
  printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" | tee -a "$LOGS/bench.log"
}

require_tools() {
  for tool in "$FFMPEG" "$FFPROBE" sha256sum awk sed grep pgrep ps du df vmstat; do
    command -v "$tool" >/dev/null 2>&1 || {
      echo "missing required tool: $tool" >&2
      exit 127
    }
  done
}

seconds_from_clock() {
  awk -F: 'NF==3 {print $1*3600+$2*60+$3} NF==2 {print $1*60+$2}' <<<"$1"
}

field() {
  awk -F': ' -v key="$1" 'index($0, key) {print $2; exit}' "$2"
}

inventory() {
  require_tools
  local out="$LOGS/inventory.txt"
  {
    echo "# DIF-V2-WO-002 inventory"
    date -u
    echo
    echo "## uname"
    uname -a
    echo
    echo "## cpu"
    lscpu | grep -E '^(Architecture|CPU\(s\)|Model name|Thread|Core|Socket|CPU max MHz|BogoMIPS|Vendor ID)' || true
    echo
    echo "## memory"
    free -m
    echo
    echo "## disk"
    df -h "$BENCH_ROOT"
    echo
    echo "## load"
    cat /proc/loadavg
    echo
    echo "## limits"
    ulimit -a
    echo
    echo "## services"
    for unit in nginx docker containerd code-server@ubuntu; do
      printf '%s: %s\n' "$unit" "$(systemctl is-active "$unit" 2>/dev/null || true)"
    done
    echo
    echo "## containers (names/status only)"
    docker ps --format '{{.Names}} {{.Status}}' 2>/dev/null || echo "docker ps unavailable"
    echo
    echo "## ffmpeg"
    "$FFMPEG" -version | head -4
    echo
    echo "## ffprobe"
    "$FFPROBE" -version | head -2
  } >"$out" 2>&1
  cat "$out"
}

generate() {
  require_tools
  mkdir -p "$CLIPS" "$AUDIO"
  local started ended
  started=$(date +%s)

  if [ ! -f "$CLIPS/clip_15.mp4" ]; then
    log "generating 15 synthetic 8 s 1080x1920 clips"
    for i in $(seq 1 15); do
      local hue=$(( (i * 24) % 360 ))
      "$FFMPEG" -hide_banner -loglevel error -y \
        -f lavfi -i "testsrc2=size=1080x1920:rate=$FPS:duration=8" \
        -vf "hue=h=$hue:s=1.15,format=yuv420p" \
        -c:v libx264 -preset ultrafast -crf 23 -an \
        "$CLIPS/clip_$(printf '%02d' "$i").mp4"
    done
  else
    log "clips already present, skipping generation"
  fi

  : >"$CONCAT"
  for i in $(seq 1 15); do
    printf "file '%s'\n" "$CLIPS/clip_$(printf '%02d' "$i").mp4" >>"$CONCAT"
  done

  if [ ! -f "$AUDIO/narration.wav" ]; then
    log "generating synthetic narration/music/sfx"
    "$FFMPEG" -hide_banner -loglevel error -y \
      -f lavfi -i "sine=frequency=210:sample_rate=48000:duration=$DURATION" \
      -af "tremolo=f=0.25:d=0.7,volume=0.25,pan=stereo|c0=c0|c1=c0" \
      -c:a pcm_s16le "$AUDIO/narration.wav"
    "$FFMPEG" -hide_banner -loglevel error -y \
      -f lavfi -i "sine=frequency=330:sample_rate=48000:duration=$DURATION" \
      -f lavfi -i "sine=frequency=440:sample_rate=48000:duration=$DURATION" \
      -filter_complex "[0:a][1:a]amix=inputs=2:duration=longest:normalize=0,volume=0.10,pan=stereo|c0=c0|c1=c0[a]" \
      -map "[a]" -c:a pcm_s16le "$AUDIO/music.wav"
    "$FFMPEG" -hide_banner -loglevel error -y \
      -f lavfi -i "anoisesrc=color=pink:sample_rate=48000:duration=$DURATION:amplitude=0.3" \
      -af "highpass=f=800,lowpass=f=6000,volume=enable='lt(mod(t\,4)\,0.3)':volume=0.5,pan=stereo|c0=c0|c1=c0" \
      -c:a pcm_s16le "$AUDIO/sfx.wav"
  else
    log "audio already present, skipping generation"
  fi

  ended=$(date +%s)
  printf 'generation_seconds=%s\n' "$((ended - started))" >"$LOGS/generate.time.txt"
  sha256sum "$CLIPS"/*.mp4 "$AUDIO"/*.wav >"$LOGS/inputs.sha256"
  du -sb "$INPUTS" >"$LOGS/inputs.size.txt"
  log "generated inputs in $((ended - started)) s; manifest $LOGS/inputs.sha256"
}

monitor_pid() {
  local pid=$1 out=$2
  : >"$out"
  while kill -0 "$pid" 2>/dev/null; do
    local rss hwm cpu
    rss=$(awk '/VmRSS/{print $2}' "/proc/$pid/status" 2>/dev/null || true)
    hwm=$(awk '/VmHWM/{print $2}' "/proc/$pid/status" 2>/dev/null || true)
    cpu=$(ps -o pcpu= -p "$pid" 2>/dev/null | tr -d ' ' || true)
    printf '%s %s %s %s\n' "$(date +%s.%N)" "${rss:-0}" "${hwm:-0}" "${cpu:-0}" >>"$out"
    sleep 0.5
  done
}

render() {
  require_tools
  local label=${1:?label}
  local width=${2:?width}
  local height=${3:?height}
  local out="$RUNS/$label"
  mkdir -p "$out"

  local disk_before disk_after
  disk_before=$(awk '$3=="sda"{print $6, $10}' /proc/diskstats)
  free -m >"$out/mem.before.txt"
  cat /proc/loadavg >"$out/load.before.txt"
  du -sb "$INPUTS" >"$out/inputs.size.txt"
  printf '%s\n' "$disk_before" >"$out/diskstats.before.txt"

  log "render $label ${width}x${height} starting"
  local started ended
  started=$(date +%s)

  vmstat 1 >"$out/vmstat.log" 2>&1 &
  local vmpid=$!

  /usr/bin/time -v -o "$out/time.txt" \
    nice -n 10 "$FFMPEG" -hide_banner -nostdin -y \
      -f concat -safe 0 -i "$CONCAT" \
      -i "$AUDIO/narration.wav" \
      -i "$AUDIO/music.wav" \
      -i "$AUDIO/sfx.wav" \
      -filter_complex "[0:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=$FPS,format=yuv420p[v];[1:a]volume=1.0[n];[2:a]volume=0.35[m];[3:a]volume=0.5[s];[n][m][s]amix=inputs=3:duration=longest:normalize=0,alimiter=limit=0.95[a]" \
      -map "[v]" -map "[a]" \
      -c:v libx264 -preset "$PRESET" -crf "$CRF" -pix_fmt yuv420p -r "$FPS" \
      -c:a aac -b:a 192k -ar 48000 -ac 2 \
      -movflags +faststart -t "$DURATION" \
      "$out/output.mp4" &
  local wrapper=$!

  local ffpid=""
  for _ in $(seq 1 50); do
    ffpid=$(pgrep -P "$wrapper" -x ffmpeg 2>/dev/null | head -1 || true)
    [ -n "$ffpid" ] && break
    sleep 0.1
  done

  local mon=""
  if [ -n "$ffpid" ]; then
    monitor_pid "$ffpid" "$out/ps.log" &
    mon=$!
  fi

  set +e
  wait "$wrapper"
  local rc=$?
  set -e

  if [ -n "$mon" ]; then
    wait "$mon" 2>/dev/null || true
  fi
  kill "$vmpid" 2>/dev/null || true
  wait "$vmpid" 2>/dev/null || true

  ended=$(date +%s)
  disk_after=$(awk '$3=="sda"{print $6, $10}' /proc/diskstats)
  printf '%s\n' "$disk_after" >"$out/diskstats.after.txt"
  free -m >"$out/mem.after.txt"
  cat /proc/loadavg >"$out/load.after.txt"
  printf 'wall_seconds=%s\nrc=%s\n' "$((ended - started))" "$rc" >"$out/run.status.txt"
  sha256sum "$out/output.mp4" >"$out/output.sha256" 2>/dev/null || true
  du -sb "$out" >"$out/run.size.txt"
  log "render $label finished rc=$rc wall=$((ended - started)) s"
  return "$rc"
}

validate() {
  require_tools
  local label=${1:?label}
  local width=${2:?width}
  local height=${3:?height}
  local out="$RUNS/$label"
  local file="$out/output.mp4"
  local report="$out/ffprobe.json"
  local decode_log="$out/decode.log"

  "$FFPROBE" -v error -show_entries format=duration,size,bit_rate \
    -show_entries stream=index,codec_type,codec_name,width,height,r_frame_rate,sample_rate,channels \
    -of json "$file" >"$report" 2>"$out/ffprobe.err"

  set +e
  "$FFMPEG" -v error -xerror -nostdin -i "$file" -f null - >"$decode_log" 2>&1
  local decode_rc=$?
  set -e

  local duration
  duration=$(awk -F'"' '/"duration"/{print $4; exit}' "$report")
  local video_ok audio_ok
  video_ok=$(grep -c '"codec_type": "video"' "$report" || true)
  audio_ok=$(grep -c '"codec_type": "audio"' "$report" || true)
  local width_actual height_actual
  width_actual=$(awk '/"width"/{print $2; exit}' "$report" | tr -d ',')
  height_actual=$(awk '/"height"/{print $2; exit}' "$report" | tr -d ',')

  local pass=1
  awk -v d="$duration" 'BEGIN{exit !(d >= 119 && d <= 121)}' || pass=0
  [ "$video_ok" -ge 1 ] || pass=0
  [ "$audio_ok" -ge 1 ] || pass=0
  [ "$width_actual" = "$width" ] || pass=0
  [ "$height_actual" = "$height" ] || pass=0
  [ "$decode_rc" -eq 0 ] || pass=0
  if [ -s "$decode_log" ]; then pass=0; fi

  {
    echo "label=$label"
    echo "expected=${width}x${height}"
    echo "duration=$duration"
    echo "video_streams=$video_ok"
    echo "audio_streams=$audio_ok"
    echo "width=$width_actual"
    echo "height=$height_actual"
    echo "decode_rc=$decode_rc"
    echo "decode_log_bytes=$(wc -c <"$decode_log")"
    echo "pass=$pass"
  } >"$out/validation.txt"
  cat "$out/validation.txt"
  [ "$pass" -eq 1 ]
}

summary() {
  local csv="$LOGS/summary.csv"
  # ps -o pcpu is a cumulative average since process start, not an instantaneous peak.
  echo "label,width,height,wall_s,elapsed_s,rtf,max_rss_kb,avg_cpu_pct,peak_hwm_kb,final_pcpu_avg_pct,output_bytes,duration_s,validation,rc" >"$csv"
  for dir in "$RUNS"/*; do
    [ -d "$dir" ] || continue
    local label file elapsed rtf rss cpu peak_hwm final_pcpu size duration val rc width height
    label=$(basename "$dir")
    file="$dir/output.mp4"
    [ -f "$dir/ffprobe.json" ] || continue
    elapsed=$(field 'Elapsed (wall clock) time' "$dir/time.txt")
    elapsed=$(seconds_from_clock "$elapsed")
    rtf=$(awk -v e="$elapsed" -v d="$DURATION" 'BEGIN{printf "%.4f", e/d}')
    rss=$(field 'Maximum resident set size' "$dir/time.txt")
    cpu=$(field 'Percent of CPU this job got' "$dir/time.txt")
    cpu=${cpu%\%}
    peak_hwm=$(awk 'BEGIN{m=0} {if($3+0>m)m=$3+0} END{print m}' "$dir/ps.log" 2>/dev/null || echo 0)
    final_pcpu=$(awk 'BEGIN{m=0} {if($4+0>m)m=$4+0} END{print m}' "$dir/ps.log" 2>/dev/null || echo 0)
    if [ -f "$file" ]; then
      size=$(stat -c %s "$file")
    else
      size=$(awk -F'"' '/"size"/{print $4; exit}' "$dir/ffprobe.json" 2>/dev/null || echo 0)
    fi
    duration=$(awk -F'"' '/"duration"/{print $4; exit}' "$dir/ffprobe.json" 2>/dev/null || echo 0)
    val=$(awk -F= '/^pass=/{print $2}' "$dir/validation.txt" 2>/dev/null || echo 0)
    rc=$(awk -F= '/^rc=/{print $2}' "$dir/run.status.txt" 2>/dev/null || echo 1)
    width=$(awk -F= '/^width=/{print $2}' "$dir/validation.txt" 2>/dev/null || echo 0)
    height=$(awk -F= '/^height=/{print $2}' "$dir/validation.txt" 2>/dev/null || echo 0)
    echo "$label,$width,$height,$(awk -F= '/^wall_seconds=/{print $2}' "$dir/run.status.txt"),$elapsed,$rtf,$rss,$cpu,$peak_hwm,$final_pcpu,$size,$duration,$val,$rc" >>"$csv"
  done
  column -s, -t "$csv" 2>/dev/null || cat "$csv"
}

health() {
  local out="$LOGS/health-$(date -u +%Y%m%dT%H%M%SZ).txt"
  {
    date -u
    echo "load: $(cat /proc/loadavg)"
    free -m | head -2
    df -h "$BENCH_ROOT" | tail -1
    for unit in nginx docker containerd code-server@ubuntu; do
      printf '%s: %s\n' "$unit" "$(systemctl is-active "$unit" 2>/dev/null || true)"
    done
    docker ps --format '{{.Names}} {{.Status}}' 2>/dev/null || true
    echo "ffmpeg processes:"
    pgrep -a ffmpeg || true
    echo "yes processes:"
    pgrep -a yes || true
  } | tee "$out"
}

short_render() {
  local label=$1
  local seconds=${2:-10}
  local out="$RUNS/$label"
  mkdir -p "$out"
  local list="$out/list.txt"
  : >"$list"
  for i in 1 2; do
    printf "file '%s'\n" "$CLIPS/clip_$(printf '%02d' "$i").mp4" >>"$list"
  done
  local started ended rc
  started=$(date +%s)
  set +e
  nice -n 10 "$FFMPEG" -hide_banner -nostdin -loglevel error -y \
    -f concat -safe 0 -i "$list" \
    -t "$seconds" -vf "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=$FPS,format=yuv420p" \
    -c:v libx264 -preset "$PRESET" -crf "$CRF" -an -pix_fmt yuv420p \
    "$out/output.mp4" 2>"$out/stderr.log"
  rc=$?
  set -e
  ended=$(date +%s)
  printf 'wall_seconds=%s\nrc=%s\n' "$((ended - started))" "$rc" >"$out/run.status.txt"
  echo "$label rc=$rc wall=$((ended - started)) s"
  return "$rc"
}

failures() {
  require_tools
  mkdir -p "$RUNS/failures"
  local f="$RUNS/failures"

  log "failure test: timeout/kill"
  set +e
  timeout -s TERM 8 nice -n 10 "$FFMPEG" -hide_banner -nostdin -loglevel error -y \
    -f concat -safe 0 -i "$CONCAT" -vf "scale=1080:1920,setsar=1,fps=$FPS,format=yuv420p" \
    -c:v libx264 -preset "$PRESET" -crf "$CRF" -an -pix_fmt yuv420p \
    "$f/timeout.mp4" >"$f/timeout.log" 2>&1
  local timeout_rc=$?
  set -e
  sleep 1
  local orphans
  orphans=$(pgrep -f "timeout.mp4" | wc -l || true)
  printf 'rc=%s\norphans=%s\n' "$timeout_rc" "$orphans" >"$f/timeout.status.txt"
  rm -f "$f/timeout.mp4"

  log "failure test: corrupt/truncated input"
  head -c 100000 "$CLIPS/clip_01.mp4" >"$f/corrupt.mp4"
  {
    printf "file '%s'\n" "$f/corrupt.mp4"
    for i in $(seq 2 15); do printf "file '%s'\n" "$CLIPS/clip_$(printf '%02d' "$i").mp4"; done
  } >"$f/corrupt-concat.txt"
  set +e
  "$FFMPEG" -hide_banner -nostdin -loglevel error -y \
    -f concat -safe 0 -i "$f/corrupt-concat.txt" -t 10 \
    -vf "scale=1080:1920,setsar=1,fps=$FPS,format=yuv420p" \
    -c:v libx264 -preset "$PRESET" -crf "$CRF" -an -pix_fmt yuv420p \
    "$f/corrupt-out.mp4" >"$f/corrupt.log" 2>&1
  local corrupt_rc=$?
  set -e
  printf 'rc=%s\n' "$corrupt_rc" >"$f/corrupt.status.txt"
  rm -f "$f/corrupt.mp4" "$f/corrupt-out.mp4" "$f/corrupt-concat.txt"

  log "failure test: simulated low disk (ulimit -f, no real disk fill)"
  set +e
  ( ulimit -f 2048; "$FFMPEG" -hide_banner -nostdin -loglevel error -y \
      -f concat -safe 0 -i "$CONCAT" -t 120 \
      -vf "scale=1080:1920,setsar=1,fps=$FPS,format=yuv420p" \
      -c:v libx264 -preset "$PRESET" -crf "$CRF" -an -pix_fmt yuv420p \
      "$f/limited.mp4" >"$f/disklimit.log" 2>&1 )
  local limit_rc=$?
  set -e
  local limit_size
  limit_size=$(stat -c %s "$f/limited.mp4" 2>/dev/null || echo 0)
  printf 'rc=%s\npartial_bytes=%s\n' "$limit_rc" "$limit_size" >"$f/disklimit.status.txt"
  rm -f "$f/limited.mp4"

  log "recovery: short valid render after failures"
  short_render failures/recovery 10
  "$FFPROBE" -v error -show_entries format=duration -of default=nw=1:nk=1 "$RUNS/failures/recovery/output.mp4" \
    >"$f/recovery.duration.txt" 2>&1
  local recovery_duration
  recovery_duration=$(cat "$f/recovery.duration.txt")
  printf 'duration=%s\n' "$recovery_duration" >>"$f/recovery.status.txt"
  awk -v d="$recovery_duration" 'BEGIN{exit !(d >= 9 && d <= 11)}' \
    && echo "recovery_pass=1" >>"$f/recovery.status.txt" \
    || echo "recovery_pass=0" >>"$f/recovery.status.txt"

  log "failure test: CPU saturation and recovery"
  short_render stress/baseline 10
  local base_wall loaded_wall recovered_wall
  base_wall=$(awk -F= '/^wall_seconds=/{print $2}' "$RUNS/stress/baseline/run.status.txt")
  (
    trap 'kill "$yes1" "$yes2" 2>/dev/null || true' EXIT
    yes >/dev/null & yes1=$!
    yes >/dev/null & yes2=$!
    cat /proc/loadavg >"$f/stress.load.during.txt"
    short_render stress/loaded 10 || true
    kill "$yes1" "$yes2" 2>/dev/null || true
    wait "$yes1" "$yes2" 2>/dev/null || true
  )
  sleep 5
  cat /proc/loadavg >"$f/stress.load.after.txt"
  short_render stress/recovered 10
  loaded_wall=$(awk -F= '/^wall_seconds=/{print $2}' "$RUNS/stress/loaded/run.status.txt")
  recovered_wall=$(awk -F= '/^wall_seconds=/{print $2}' "$RUNS/stress/recovered/run.status.txt")
  {
    echo "baseline_wall_s=$base_wall"
    echo "loaded_wall_s=$loaded_wall"
    echo "recovered_wall_s=$recovered_wall"
    echo "slowdown_ratio=$(awk -v b="$base_wall" -v l="$loaded_wall" 'BEGIN{if(b>0) printf "%.3f", l/b; else print "n/a"}')"
    echo "recovery_ratio=$(awk -v b="$base_wall" -v r="$recovered_wall" 'BEGIN{if(b>0) printf "%.3f", r/b; else print "n/a"}')"
  } >"$f/stress.status.txt"
  cat "$f/stress.status.txt"
  rm -rf "$RUNS/stress"

  health
}

cleanup() {
  case "$BENCH_ROOT" in
    "$HOME"/v2-bench*) ;;
    *)
      echo "refusing to clean unexpected BENCH_ROOT: $BENCH_ROOT" >&2
      exit 2
      ;;
  esac
  local size
  size=$(du -sh "$BENCH_ROOT" 2>/dev/null | awk '{print $1}' || true)
  log "cleanup: removing $BENCH_ROOT (size ${size:-unknown})"
  rm -rf "$BENCH_ROOT"
  echo "removed $BENCH_ROOT (size ${size:-unknown})"
}

main() {
  local cmd=${1:-}
  case "$cmd" in
    inventory) inventory ;;
    generate) generate ;;
    render) render "${2:-}" "${3:-}" "${4:-}" ;;
    validate) validate "${2:-}" "${3:-}" "${4:-}" ;;
    summary) summary ;;
    health) health ;;
    failures) failures ;;
    cleanup) cleanup ;;
    *)
      echo "usage: $0 {inventory|generate|render LABEL W H|validate LABEL W H|summary|health|failures|cleanup}" >&2
      exit 2
      ;;
  esac
}

main "$@"
