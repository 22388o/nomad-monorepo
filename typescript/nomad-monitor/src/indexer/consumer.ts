import { ethers } from 'ethers';
import { EventType, NomadEvent } from './event';
import { Statistics } from './types';



class StatisticsCollector {
  
  s: Statistics;
  constructor(domains: number[]) {
    this.s = new Statistics(domains);
  }

  addDispatched(domain: number) {
    this.s.counts.total.dispatched += 1;
    this.s.counts.domainStatistics.get(domain)!.dispatched += 1;
  }

  addUpdated(domain: number) {
    this.s.counts.total.updated += 1;
    this.s.counts.domainStatistics.get(domain)!.updated += 1;
  }

  addRelayed(domain: number) {
    this.s.counts.total.relayed += 1;
    this.s.counts.domainStatistics.get(domain)!.relayed += 1;
  }

  addProcessed(domain: number) {
    this.s.counts.total.processed += 1;
    this.s.counts.domainStatistics.get(domain)!.processed += 1;
  }

  contributeUpdateTimings(m: NomadMessage) {
    const inUpdateStat = m.timings.inUpdated();
    if (inUpdateStat) {
      this.s.timings.total.meanUpdate.add(inUpdateStat)
      this.s.timings.domainStatistics.get(m.origin)!.meanUpdate.add(inUpdateStat)
    }
  }

  contributeRelayTimings(m: NomadMessage) {
    this.contributeUpdateTimings(m);
    const inRelayStat = m.timings.inRelayed();
    if (inRelayStat) {
      this.s.timings.total.meanRelay.add(inRelayStat)
      this.s.timings.domainStatistics.get(m.origin)!.meanRelay.add(inRelayStat)
    }
  }

  contributeProcessTimings(m: NomadMessage) {
    this.contributeRelayTimings(m);
    const inProcessStat = m.timings.inProcessed();
    if (inProcessStat) {
      this.s.timings.total.meanProcess.add(inProcessStat)
      this.s.timings.domainStatistics.get(m.origin)!.meanProcess.add(inProcessStat)
    }

    const e2e = m.timings.e2e();
    if (e2e) {
      this.s.timings.total.meanE2E.add(e2e)
      this.s.timings.domainStatistics.get(m.origin)!.meanE2E.add(e2e)
    }
  }

  contributeToCount(m: NomadMessage) {
    switch (m.state) {
      case MsgState.Dispatched:
        this.addDispatched(m.origin);
        break;
      case MsgState.Updated:
        this.addUpdated(m.origin);
        // this.contributeUpdateTimings(m);
        break;
      case MsgState.Relayed:
        this.addRelayed(m.origin);
        // this.contributeRelayTimings(m);
        break;
      case MsgState.Processed:
        this.addProcessed(m.origin);
        // this.contributeProcessTimings(m);
        break;
      default:
        break;
    }
  }

  contributeToTime(m: NomadMessage) {
    switch (m.state) {
      // case MsgState.Dispatched:
      //   this.addDispatched(m.origin);
      //   break;
      case MsgState.Updated:
        // this.addUpdated(m.origin);
        this.contributeUpdateTimings(m);
        break;
      case MsgState.Relayed:
        // this.addRelayed(m.origin);
        this.contributeRelayTimings(m);
        break;
      case MsgState.Processed:
        // this.addProcessed(m.origin);
        this.contributeProcessTimings(m);
        break;
      default:
        break;
    }
  }

  stats(): Statistics {
    return this.s;
  }
}


export abstract class Consumer {
  abstract consume(...evens: NomadEvent[]): void;
  abstract stats(): Statistics;
}

enum MsgState {
  Dispatched,
  Updated,
  Relayed,
  Processed,
}

class Timings {
  dispatchedAt: number;
  updatedAt: number;
  relayedAt: number;
  processedAt: number;

  constructor(ts: number) {
    this.dispatchedAt = ts;
    this.updatedAt = 0;
    this.relayedAt = 0;
    this.processedAt = 0;
  }

  updated(ts: number) {
    this.updatedAt = ts;
  }

  relayed(ts: number) {
    this.relayedAt = ts;
  }

  processed(ts: number) {
    this.processedAt = ts;
  }

  inUpdated(): number | undefined {
    if (this.updatedAt) {
      return this.updatedAt - this.dispatchedAt;
    }
    return undefined
  }

  inRelayed(): number | undefined {
    if (this.relayedAt) {
      return this.relayedAt - (this.updatedAt || this.dispatchedAt); // because of the problem with time that it is not ideal from RPC we could have skipped some stages. we take the last available
    }
    return undefined
  }

  inProcessed(): number | undefined {
    if (this.processedAt) {
      return this.processedAt - (this.relayedAt || this.updatedAt || this.dispatchedAt); // because of the problem with time that it is not ideal from RPC we could have skipped some stages. we take the last available
    }
    return undefined
  }

  e2e(): number | undefined {
    if (this.processedAt) {
      return this.processedAt - (this.dispatchedAt || this.updatedAt || this.relayedAt); // same as for .inRelayed() and .inProcessed() but opposit order
    }
    return undefined
  }


}

class NomadMessage {
  origin: number;
  destination: number;
  root: string;
  hash: string;
  leafIndex: ethers.BigNumber;
  destinationAndNonce: ethers.BigNumber;
  message: string;
  state: MsgState;
  timings: Timings;

  constructor(
    origin: number,
    destination: number,
    root: string,
    hash: string,
    leafIndex: ethers.BigNumber,
    destinationAndNonce: ethers.BigNumber,
    message: string,
    createdAt: number,
  ) {
    this.origin = origin;
    this.destination = destination;
    this.root = root;
    this.hash = hash;
    this.leafIndex = leafIndex;
    this.destinationAndNonce = destinationAndNonce;
    this.message = message;

    this.state = MsgState.Dispatched;
    this.timings = new Timings(createdAt);
  }

  get originAndRoot(): string {
    return `${this.origin}${this.root}`;
  }
}

export class Processor extends Consumer {
  messages: NomadMessage[];
  msgToIndex: Map<string, number>;
  msgByOriginAndRoot: Map<string, number[]>;
  consumed: number; // for debug
  domains: number[];


  constructor() {
    super();
    this.messages = [];
    this.msgToIndex = new Map();
    this.msgByOriginAndRoot = new Map();
    this.consumed = 0;
    this.domains = [];
  }

  consume(...events: NomadEvent[]): void {
    console.log(`Going to consume`, events.length, `events`);
    for (const event of events) {
      if (event.eventType === EventType.HomeDispatch) {
        this.dispatched(event);
      } else if (event.eventType === EventType.HomeUpdate) {
        this.homeUpdate(event);
      } else if (event.eventType === EventType.ReplicaUpdate) {
        this.replicaUpdate(event);
      } else if (event.eventType === EventType.ReplicaProcess) {
        this.process(event);
      }
  
      this.consumed += 1;
    }
  }

  dispatched(e: NomadEvent) {
    const m = new NomadMessage(
      e.domain,
      e.destination(),
      e.eventData.committedRoot!,
      e.eventData.messageHash!,
      e.eventData.leafIndex!,
      e.eventData.destinationAndNonce!,
      e.eventData.message!,
      e.ts,
    );
    this.add(m);

    if (!this.domains.includes(e.domain)) this.domains.push(e.domain);
  }

  homeUpdate(e: NomadEvent) {
    const ms = this.getMsgsByOriginAndRoot(e.domain, e.eventData.oldRoot!);
    if (ms.length) ms.forEach(m => {
        if (m.state < MsgState.Updated) {
          m.state = MsgState.Updated;
          m.timings.updated(e.ts);
        }
    });
  }

  replicaUpdate(e: NomadEvent) {
    const ms = this.getMsgsByOriginAndRoot(e.replicaOrigin, e.eventData.oldRoot!);
    if (ms.length) ms.forEach(m => {
        if (m.state < MsgState.Relayed) {
          m.state = MsgState.Relayed;
          m.timings.relayed(e.ts);
        }
    });
  }

  process(e: NomadEvent) {
    const m = this.getMsg(e.eventData.messageHash!);
    if (m) {
        if (m.state < MsgState.Processed) {
          m.state = MsgState.Processed;
          m.timings.processed(e.ts);
        }
    }
  }

  add(m: NomadMessage) {
    const index = this.messages.length;
    this.msgToIndex.set(m.hash, index);
    const x = this.msgByOriginAndRoot.get(m.originAndRoot);
    if (x) {
        x.push(index)
    } else {
        this.msgByOriginAndRoot.set(m.originAndRoot, [index]);
    }
    this.messages.push(m);
  }

  getMsg(id: string | number): NomadMessage | undefined {
    if (typeof id === 'string') {
      const msgIndex = this.msgToIndex.get(id);
      if (msgIndex) return this.messages[msgIndex];
    } else {
      return this.messages[id];
    }
    return undefined;
  }

  getMsgsByOriginAndRoot(
    origin: number,
    root: string,
  ): NomadMessage[] {
    const originAndRoot = `${origin}${root}`;
    const msgIndexs = this.msgByOriginAndRoot.get(originAndRoot);
    if (msgIndexs) return msgIndexs.map(msgIndex => this.messages[msgIndex])
    return [];
  }

  stats(): Statistics {

    const collector = new StatisticsCollector(this.domains);
    
    this.messages.forEach((m) => {
      collector.contributeToCount(m)
    });

    this.messages.slice(this.messages.length - 50).forEach((m) => {
      collector.contributeToTime(m)
    });

    

    return collector.stats();
  }
}