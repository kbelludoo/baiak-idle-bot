export interface HuntBenchmark {
  huntId: string;
  huntName: string;
  durationSeconds: number;
  kills: number;
  goldEarned: number;
  killsPerHour: number;
  goldPerHour: number;
  deaths: number;
}

export class Profiler {
  public startTime = Date.now();
  public activeHuntId = '';
  public activeHuntName = '';
  public sessionKills = 0;
  public sessionWaves = 0;
  public sessionDeaths = 0;
  public startGold = 0;
  public currentGold = 0;
  public benchmarks: Map<string, HuntBenchmark> = new Map();

  public recordTick(hunt: string, kills: number, waves: number, gold: number, deaths: number) {
    this.sessionKills = kills;
    this.sessionWaves = waves;
    this.currentGold = gold;
    this.sessionDeaths = deaths;
    this.activeHuntName = hunt;
  }

  public getRates() {
    const elapsedHours = Math.max(0.001, (Date.now() - this.startTime) / 3600000);
    const goldDiff = Math.max(0, this.currentGold - this.startGold);
    
    return {
      killsPerHour: Math.round(this.sessionKills / elapsedHours),
      wavesPerHour: Math.round(this.sessionWaves / elapsedHours),
      goldPerHour: Math.round(goldDiff / elapsedHours),
      elapsedMinutes: Math.round(elapsedHours * 60)
    };
  }
}
