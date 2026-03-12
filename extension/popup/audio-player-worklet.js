// popup/audio-player-worklet.js (AudioWorklet)
// Reference pattern: AudioPlayerProcessor with queue + flush for barge-in

class AudioPlayerProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.audioQueue = [];
    this.currentChunk = null;
    this.currentChunkIndex = 0;

    this.port.onmessage = (event) => {
      if (event.data.type === 'audio_data') {
        const pcmData = new Int16Array(event.data.buffer);
        this.audioQueue.push(pcmData);
      } else if (event.data.type === 'flush') {
        // Barge-in: clear buffer immediately
        this.audioQueue = [];
        this.currentChunk = null;
        this.currentChunkIndex = 0;
      }
    };
  }

  process(inputs, outputs) {
    const outputChannel = outputs[0][0];

    for (let i = 0; i < outputChannel.length; i++) {
      if (!this.currentChunk || this.currentChunkIndex >= this.currentChunk.length) {
        if (this.audioQueue.length > 0) {
          this.currentChunk = this.audioQueue.shift();
          this.currentChunkIndex = 0;
        } else {
          outputChannel[i] = 0;
          continue;
        }
      }

      const sample = this.currentChunk[this.currentChunkIndex];
      outputChannel[i] = sample / 32768.0;
      this.currentChunkIndex++;
    }

    return true;
  }
}

registerProcessor('audio-player-processor', AudioPlayerProcessor);
