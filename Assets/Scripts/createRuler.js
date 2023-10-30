let canvas = document.createElement('canvas');
let maxWaveHeight = 5;
let resolution = 300;

canvas.width = resolution;
canvas.height = maxWaveHeight * 2 * resolution;

let ctx = canvas.getContext('2d');

ctx.fillStyle = 'yellow';
ctx.fillRect(0, 0, canvas.width, canvas.height);
ctx.textAlign = "center";


let flip = true;
for (let i = -maxWaveHeight; i <= maxWaveHeight; i+=0.1){

  let meter = parseFloat(i.toFixed(2));
  let normMeter = (meter + maxWaveHeight) / (maxWaveHeight * 2);

  let bigMark = meter % 1 == 0;
  let middleMark = meter % 0.5 == 0 && !bigMark;
  
  let lineLength = 0.1;
  ctx.lineWidth = 1;
  ctx.font = '10px Sans Serif';

  if (bigMark){
    ctx.font = '30px Sans Serif';
    ctx.lineWidth = 10;
    lineLength = 0.25;
    // Add units (meters)
    ctx.fillStyle = "black";
    if (flip){
      ctx.rotate(-90 * Math.PI / 180);
      ctx.fillText('meters', - (normMeter + 0.05) * canvas.height, canvas.width * 0.3);
      ctx.rotate(90 * Math.PI / 180);
    } else if (flip == false){
      console.log("here");
      ctx.rotate(90 * Math.PI / 180);
      ctx.fillText('meters', (normMeter + 0.05) * canvas.height, - canvas.width * 0.70);
      ctx.rotate(-90 * Math.PI / 180);
    }
    flip = !flip;
  } else if (middleMark){
    ctx.font = '20px Sans Serif';
    ctx.lineWidth = 5;
    lineLength = 0.17;
  }

  ctx.beginPath();
  ctx.moveTo(canvas.width * (0.5 - lineLength), (1-normMeter) * canvas.height);
  ctx.lineTo(canvas.width * (0.5 + lineLength), (1-normMeter) * canvas.height);
  ctx.stroke();

  
  ctx.fillStyle = "black";
  ctx.fillText(meter.toFixed(1), canvas.width * 0.12, 10 + (1-normMeter) * canvas.height);
  ctx.fillText(meter.toFixed(1), canvas.width * 0.88, 10 + (1-normMeter) * canvas.height);

}


canvas.style = `position: absolute; top: 0px; left: 0px`;
document.body.appendChild(canvas);


const link = document.createElement('a');
link.download = 'ruler.png';
link.href = canvas.toDataURL();
link.click();
link.delete;