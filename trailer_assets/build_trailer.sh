#!/bin/bash
cd /home/vmuser/Desktop/GENESIS-CGV/trailer_assets

# Create polished trailer with crossfades and music
ffmpeg -y \
  -i black_intro.mp4 \
  -i opening_lvl1_cut.mp4 \
  -i invasion-card.mp4 \
  -i opening_lvl1_cut2.mp4 \
  -i fighting_warden_cut.mp4 \
  -i opening_lvl2_cut.mp4 \
  -i fighting_enforcer_cut.mp4 \
  -i opening_lvl3_cut.mp4 \
  -i architect_cut.mp4 \
  -i architect_cut2.mp4 \
  -i genesis-card.mp4 \
  -i tagline-card.mp4 \
  -i coming-soon-card.mp4 \
  -i level_1_chiptune.ogg \
  -i level_2_orchestral.ogg \
  -i level_3_electronic.mp3 \
  -filter_complex "
    [0:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2[v0];
    [1:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2[v1];
    [2:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2[v2];
    [3:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2[v3];
    [4:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2[v4];
    [5:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2[v5];
    [6:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2[v6];
    [7:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2[v7];
    [8:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2[v8];
    [9:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2[v9];
    [10:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2[v10];
    [11:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2[v11];
    [12:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2[v12];
    
    [v0][v1]xfade=transition=fade:duration=0.5:offset=2.5[x01];
    [x01][v2]xfade=transition=fade:duration=0.5:offset=5.5[x02];
    [x02][v3]xfade=transition=fade:duration=0.5:offset=8.5[x03];
    [x03][v4]xfade=transition=fade:duration=0.5:offset=11.5[x04];
    [x04][v5]xfade=transition=fade:duration=0.5:offset=20.5[x05];
    [x05][v6]xfade=transition=fade:duration=0.5:offset=29.5[x06];
    [x06][v7]xfade=transition=fade:duration=0.5:offset=38.5[x07];
    [x07][v8]xfade=transition=fade:duration=0.5:offset=48.5[x08];
    [x08][v9]xfade=transition=fade:duration=0.5:offset=58.5[x09];
    [x09][v10]xfade=transition=fade:duration=0.5:offset=63.5[x10];
    [x10][v11]xfade=transition=fade:duration=0.5:offset=66.5[x11];
    [x11][v12]xfade=transition=fade:duration=0.5:offset=68.5[vout];
    
    [13:a]afade=t=in:st=3:d=2,afade=t=out:st=28:d=2[a1];
    [14:a]afade=t=in:st=28:d=2,afade=t=out:st=46:d=2[a2];
    [15:a]afade=t=in:st=46:d=2,afade=t=out:st=68:d=2[a3];
    [a1][a2][a3]amix=inputs=3:duration=longest[aout]
  " \
  -map "[vout]" -map "[aout]" \
  -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p -r 60 \
  -c:a aac -b:a 320k \
  -shortest \
  GENESIS_Trailer_Final.mp4 2>&1 | tail -10

echo "Final trailer created!"
