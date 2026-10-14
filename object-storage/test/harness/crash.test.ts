import { describe, expect, it } from 'vitest';
import { CrashError } from '../../sim/crash';
import { Simulation } from '../../sim/env';

const b = (...xs: number[]) => new Uint8Array(xs);

describe('harness: crash points and process restart', () => {
  it('records each cluster write, db write and queue publish as a step', async () => {
    const sim = await Simulation.create();
    const env = sim.env();
    env.db.exec('CREATE TABLE t (k TEXT)');
    sim.crash.resetLog();
    await env.cluster.putChunk('az1-n2', 'c1', b(1));
    await env.cluster.getChunk('az1-n2', 'c1');
    env.db.run("INSERT INTO t VALUES ('a')");
    env.db.all('SELECT * FROM t');
    env.db.transaction(() => {
      env.db.run("INSERT INTO t VALUES ('b')");
      env.db.run("INSERT INTO t VALUES ('c')");
    });
    await env.queue.publish('events', { n: 1 });
    await env.cluster.deleteChunk('az1-n2', 'c1');
    expect(sim.crash.steps.map((s) => s.kind)).toEqual([
      'chunk.write',
      'db.write',
      'db.write',
      'queue.publish',
      'chunk.delete',
    ]);
  });

  it('crashBeforeStep(n) kills the process before its n-th step; the step does not happen', async () => {
    const sim = await Simulation.create();
    const env = sim.env();
    sim.crash.crashBeforeStep(2);
    await env.cluster.putChunk('az1-n2', 'c1', b(1));
    await expect(env.cluster.putChunk('az1-n2', 'c2', b(2))).rejects.toBeInstanceOf(CrashError);
    expect(sim.cluster.hasChunk('az1-n2', 'c1')).toBe(true);
    expect(sim.cluster.hasChunk('az1-n2', 'c2')).toBe(false);
    expect(sim.crash.crashes).toBe(1);
    // The dead process can do nothing more, reads included.
    await expect(env.cluster.getChunk('az1-n2', 'c1')).rejects.toBeInstanceOf(CrashError);
    expect(() => env.db.all('SELECT 1')).toThrow(CrashError);
  });

  it('crashBefore(kind, { after }) fires at the first matching step after the other kind', async () => {
    const sim = await Simulation.create();
    const env = sim.env();
    env.db.exec('CREATE TABLE t (k TEXT)');
    sim.crash.crashBefore('db.write', { after: 'chunk.write' });
    env.db.run("INSERT INTO t VALUES ('intent')");
    await env.cluster.putChunk('az2-n2', 'c1', b(1));
    await env.cluster.putChunk('az3-n2', 'c1', b(1));
    expect(() => env.db.transaction(() => env.db.run("INSERT INTO t VALUES ('commit')"))).toThrow(CrashError);
    const fresh = sim.restartProcess();
    expect(fresh.db.all('SELECT k FROM t')).toEqual([{ k: 'intent' }]);
  });

  it('a write in flight when the process crashes still lands; the dead process never sees the result', async () => {
    const sim = await Simulation.create();
    const env = sim.env();
    sim.crash.crashBeforeStep(2);
    const inFlight = env.cluster.putChunk('az2-n3', 'c1', b(1));
    await expect(env.cluster.putChunk('az2-n3', 'c2', b(2))).rejects.toBeInstanceOf(CrashError);
    await expect(inFlight).rejects.toBeInstanceOf(CrashError);
    expect(sim.cluster.hasChunk('az2-n3', 'c1')).toBe(true);
  });

  it('restartProcess gives a working env over the same cluster, database and queue', async () => {
    const sim = await Simulation.create();
    const env = sim.env();
    env.db.exec('CREATE TABLE t (k TEXT)');
    env.db.run("INSERT INTO t VALUES ('kept')");
    await env.cluster.putChunk('az1-n2', 'c1', b(9));
    sim.crash.crashBeforeStep(1);
    expect(() => env.db.run("INSERT INTO t VALUES ('lost')")).toThrow(CrashError);
    const env2 = sim.restartProcess();
    expect(sim.env()).toBe(env2);
    expect(env2.db.all('SELECT k FROM t')).toEqual([{ k: 'kept' }]);
    expect(await env2.cluster.getChunk('az1-n2', 'c1')).toEqual(b(9));
    expect(() => env.db.all('SELECT 1')).toThrow(CrashError);
  });

  it('disarm cancels a crash that has not fired', async () => {
    const sim = await Simulation.create();
    sim.crash.crashBeforeStep(1);
    sim.crash.disarm();
    await sim.env().cluster.putChunk('az1-n2', 'c1', b(1));
    expect(sim.crash.crashes).toBe(0);
  });
});
