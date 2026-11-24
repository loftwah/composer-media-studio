// MIT. The workbench's fictional, browser-generated sample artwork. Shared by
// the gallery sample and Title + thumbnail compare so both draw identical pixels.

export function drawSample(canvas: HTMLCanvasElement): void {
  const width = canvas.width;
  const height = canvas.height;
  const context = canvas.getContext("2d");
  if (!context) return;
  const gradient = context.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, "#0f3f3b");
  gradient.addColorStop(0.55, "#1f5c58");
  gradient.addColorStop(1, "#d9b26f");
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);
  context.globalAlpha = 0.22;
  context.strokeStyle = "#ffffff";
  context.lineWidth = 2;
  for (let x = -height; x < width; x += 64) {
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x + height, height);
    context.stroke();
  }
  context.globalAlpha = 1;
  const shapes = [
    { x: width * 0.18, y: height * 0.6, r: height * 0.26, color: "#f0b35b" },
    { x: width * 0.42, y: height * 0.36, r: height * 0.18, color: "#f7f1e6" },
    { x: width * 0.7, y: height * 0.58, r: height * 0.32, color: "#8adeb0" },
  ];
  for (const shape of shapes) {
    context.globalAlpha = 0.82;
    context.fillStyle = shape.color;
    context.beginPath();
    context.arc(shape.x, shape.y, shape.r, 0, Math.PI * 2);
    context.fill();
  }
  context.globalAlpha = 1;
  context.fillStyle = "#f7f1e6";
  context.font = `700 ${Math.round(height * 0.1)}px system-ui, sans-serif`;
  context.fillText("LOCAL IMAGE", width * 0.07, height * 0.24);
  context.font = `500 ${Math.round(height * 0.042)}px system-ui, sans-serif`;
  context.fillText("A sample made in this tab. Drag it, crop it, export it.", width * 0.07, height * 0.32);
  context.fillStyle = "rgba(0,0,0,0.32)";
  context.fillRect(0, height - Math.round(height * 0.13), width, Math.round(height * 0.13));
  context.fillStyle = "#f7f1e6";
  context.font = `500 ${Math.round(height * 0.035)}px system-ui, sans-serif`;
  context.fillText("Media Studio · signed-out local workbench", width * 0.07, height - Math.round(height * 0.052));
}
