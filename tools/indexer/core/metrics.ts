import { Gauge, Histogram, Counter } from "prom-client";
import Logger from "bunyan";

import { register } from "prom-client";
import express, { Response } from "express";

const buckets = [
  1 * 60, // 1 min
  5 * 60, // 5 min
  10 * 60, // 10 min
  20 * 60, // 20 min
  30 * 60, // 30 min
  60 * 60, // 1 hr
  120 * 60, // 2 hrs
  240 * 60, // 4 hrs
  480 * 60, // 8 hrs
  960 * 60, // 16 hrs
  1920 * 60, // 32 hrs
];

export class MetricsCollector {
  readonly environment: string;
  private readonly logger: Logger;

  constructor(environment: string, logger: Logger) {
    this.environment = environment;
    this.logger = logger;
  }

  /**
   * Starts a server that exposes metrics in the prometheus format
   */
  startServer(port: number) {
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      throw Error(`Invalid PrometheusPort value: ${port}`);
    }
    const server = express();
    server.get("/metrics", async (_, res: Response) => {
      res.set("Content-Type", register.contentType);
      res.end(await register.metrics());
    });

    this.logger.info(
      {
        endpoint: `http://0.0.0.0:${port}/metrics`,
      },
      "Prometheus metrics exposed"
    );
    server.listen(port);
  }
}

const prefix = `fancy_monitor`;

export class IndexerCollector extends MetricsCollector {
  private numMessages: Gauge<string>;

  private homeFailedGauge: Gauge<string>;

  private latency: Histogram<string>;

  private gasUsage: Histogram<string>;

  // private dbQueries: Histogram<string>;





  constructor(environment: string, logger: Logger) {
    super(environment, logger);

    // Count

    this.numMessages = new Gauge({
      name: prefix + "_number_messages",
      help: "Gauge that indicates how many messages are in dispatch, update, relay, receive or process stages",
      labelNames: ["stage", "network", "environment"],
    });



    // Time Histograms

    this.latency = new Histogram({
      name: prefix + "_latency",
      help: "Histogram that tracks latency of how long does it take to move between dispatch, update, relay, receive or process stages.",
      labelNames: ["stage", "home", "replica", "environment"],
      buckets,
    });

    // Gas

    this.gasUsage = new Histogram({
      name: prefix + "_gas_usage",
      help: "Histogram that tracks gas usage of a transaction that initiated at dispatch, update, relay, receive or process stages.",
      labelNames: ["stage", "home", "replica", "environment"],
      buckets,
    });

    // Home Health

    this.homeFailedGauge = new Gauge({
      name: "nomad_monitor_home_failed",
      help: "Gauge that indicates if home of a network is in failed state.",
      labelNames: ["network", "environment"],
    });
  }

  /**
   * Sets the state for a bridge.
   */
  setHomeState(
    network: string,
    homeFailed: boolean
  ) {
    this.homeFailedGauge.set(
      { network, environment: this.environment },
      homeFailed ? 1 : 0
    );
  }

  

  incNumMessages(stage: string, network: string) {
    this.numMessages.labels(stage, network, this.environment).inc()
  }
  decNumMessages(stage: string, network: string) {
    this.numMessages.labels(stage, network, this.environment).dec()
  }
  setNumMessages(stage: string, network: string, count: number) {
    this.numMessages.labels(stage, network, this.environment).set(count)
  }

  observeLatency(stage: string, home: string, replica: string, ms: number) {
    this.latency.labels(stage, home, replica, this.environment).observe(ms)
  }

  observeGasUsage(stage: string, home: string, replica: string, gas: number) {
    this.gasUsage.labels(stage, home, replica, this.environment).observe(gas)
  }
}
