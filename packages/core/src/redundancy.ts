export class RedundancyController {
  factor = 1.5
  private lowRounds = 0
  private smoothedLoss = 0

  observe(dropout: number, timeouts: number): number {
    const loss = Math.min(1, dropout + timeouts)
    this.smoothedLoss = this.smoothedLoss * 0.35 + loss * 0.65
    const target = Math.max(1.25, Math.min(4, Math.ceil(0.9 / Math.max(0.2, 1 - this.smoothedLoss) * 4) / 4))
    if (target > this.factor) {
      this.factor = target
      this.lowRounds = 0
    } else if (target < this.factor - 0.125) {
      this.lowRounds++
      if (this.lowRounds >= 3) {
        this.factor = Math.max(target, this.factor - 0.25)
        this.lowRounds = 0
      }
    } else this.lowRounds = 0
    return this.factor
  }
}
