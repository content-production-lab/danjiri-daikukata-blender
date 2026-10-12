// 画像素材を使わず、canvas で手続き的にテクスチャを作る。

import * as THREE from 'three';
import { mulberry32 } from '../sim/game';

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D canvas が使えません');
  return [c, ctx];
}

function toTexture(c: HTMLCanvasElement, repeat = false, srgb = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

function noise(ctx: CanvasRenderingContext2D, w: number, h: number, amount: number, seed: number) {
  const rnd = mulberry32(seed);
  const img = ctx.getImageData(0, 0, w, h);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rnd() - 0.5) * amount;
    img.data[i] += n;
    img.data[i + 1] += n;
    img.data[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
}

/** アスファルト（継ぎ目とひび） */
export function asphalt(): THREE.CanvasTexture {
  const [c, ctx] = canvas(512, 512);
  ctx.fillStyle = '#4a4a4c';
  ctx.fillRect(0, 0, 512, 512);
  noise(ctx, 512, 512, 46, 1);
  const rnd = mulberry32(2);
  ctx.strokeStyle = 'rgba(25,25,25,0.5)';
  for (let i = 0; i < 18; i++) {
    ctx.lineWidth = 0.6 + rnd() * 1.2;
    ctx.beginPath();
    let x = rnd() * 512;
    let y = rnd() * 512;
    ctx.moveTo(x, y);
    for (let k = 0; k < 6; k++) {
      x += (rnd() - 0.5) * 50;
      y += (rnd() - 0.5) * 50;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = `rgba(${rnd() > 0.5 ? '30,30,30' : '95,95,95'},0.25)`;
    ctx.beginPath();
    ctx.ellipse(rnd() * 512, rnd() * 512, 4 + rnd() * 30, 3 + rnd() * 18, rnd() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  const t = toTexture(c, true);
  t.repeat.set(60, 60);
  return t;
}

/** 欅（けやき）の木地。白木に近い明るい色と木目 */
export function keyaki(dark = false): THREE.CanvasTexture {
  const [c, ctx] = canvas(256, 256);
  ctx.fillStyle = dark ? '#5a3a22' : '#a8794a';
  ctx.fillRect(0, 0, 256, 256);
  const rnd = mulberry32(dark ? 11 : 12);
  for (let i = 0; i < 70; i++) {
    const y = rnd() * 256;
    ctx.strokeStyle = `rgba(${dark ? '30,15,5' : '90,55,25'},${0.15 + rnd() * 0.3})`;
    ctx.lineWidth = 0.5 + rnd() * 2;
    ctx.beginPath();
    ctx.moveTo(0, y);
    for (let x = 0; x <= 256; x += 16) ctx.lineTo(x, y + Math.sin(x * 0.03 + i) * (2 + rnd() * 3));
    ctx.stroke();
  }
  noise(ctx, 256, 256, 18, 13);
  return toTexture(c, true);
}

/** 漆喰（しっくい）の壁 */
export function plaster(): THREE.CanvasTexture {
  const [c, ctx] = canvas(256, 256);
  ctx.fillStyle = '#e6dfd0';
  ctx.fillRect(0, 0, 256, 256);
  const rnd = mulberry32(51);
  for (let i = 0; i < 30; i++) {
    ctx.fillStyle = `rgba(${rnd() > 0.5 ? '120,110,95' : '255,255,250'},${0.05 + rnd() * 0.08})`;
    ctx.beginPath();
    ctx.ellipse(rnd() * 256, rnd() * 256, 10 + rnd() * 50, 6 + rnd() * 30, rnd() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  // 雨だれの汚れ
  for (let i = 0; i < 12; i++) {
    const x = rnd() * 256;
    const g = ctx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, 'rgba(90,80,70,0.12)');
    g.addColorStop(1, 'rgba(90,80,70,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x, 0, 2 + rnd() * 6, 256);
  }
  noise(ctx, 256, 256, 14, 52);
  return toTexture(c, true);
}

/** 瓦屋根 */
export function roofTiles(): THREE.CanvasTexture {
  const [c, ctx] = canvas(128, 128);
  ctx.fillStyle = '#3a3d44';
  ctx.fillRect(0, 0, 128, 128);
  for (let y = 0; y < 128; y += 16) {
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(0, y + 13, 128, 3);
    for (let x = (y / 16) % 2 ? 8 : 0; x < 128; x += 16) {
      ctx.fillStyle = 'rgba(120,125,135,0.25)';
      ctx.fillRect(x + 1, y, 6, 12);
    }
  }
  noise(ctx, 128, 128, 14, 41);
  return toTexture(c, true);
}

/** 団扇（町の印入り） */
export function uchiwa(mark: string): THREE.CanvasTexture {
  const [c, ctx] = canvas(256, 256);
  ctx.fillStyle = '#f4efe6';
  ctx.beginPath();
  ctx.arc(128, 128, 126, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#b8231d';
  ctx.beginPath();
  ctx.arc(128, 128, 112, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#f4efe6';
  ctx.font = 'bold 140px "Yu Mincho", "Hiragino Mincho ProN", serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(mark, 128, 136);
  ctx.strokeStyle = 'rgba(80,40,20,0.35)';
  for (let a = 0; a < Math.PI * 2; a += Math.PI / 24) {
    ctx.beginPath();
    ctx.moveTo(128, 128);
    ctx.lineTo(128 + Math.cos(a) * 126, 128 + Math.sin(a) * 126);
    ctx.stroke();
  }
  return toTexture(c);
}

/** 提灯 */
export function lantern(): THREE.CanvasTexture {
  const [c, ctx] = canvas(128, 128);
  ctx.fillStyle = '#d63a22';
  ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  for (let y = 6; y < 128; y += 10) ctx.fillRect(0, y, 128, 2);
  ctx.fillStyle = '#fff4d8';
  ctx.font = 'bold 54px serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('祭', 64, 68);
  return toTexture(c);
}

/** 空のグラデーション */
export function sky(): THREE.CanvasTexture {
  const [c, ctx] = canvas(16, 256);
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, '#3f78c4');
  g.addColorStop(0.45, '#8db8e2');
  g.addColorStop(0.5, '#cfe0ec');
  g.addColorStop(1, '#d8d4c8');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 16, 256);
  return toTexture(c);
}
