// Captura do microfone na thread de áudio (imune a travadas da animação do rosto na thread principal).
// Junta os blocos de 128 amostras em blocos de 2048 e manda pro app.
class MicTap extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(2048); this.n = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      for (let i = 0; i < ch.length; i++) {
        this.buf[this.n++] = ch[i];
        if (this.n === 2048) { this.port.postMessage(this.buf.slice(0)); this.n = 0; }
      }
    }
    return true;
  }
}
registerProcessor('mic-tap', MicTap);
