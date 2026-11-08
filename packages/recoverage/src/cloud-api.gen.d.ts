// Generated from recoverage.cloud/src/api.ts. Run bun run --cwd recoverage.cloud gen:api.
import * as Istanbul from "istanbul-lib-coverage";
type CoverageEval = {
  total: number;
  covered: number;
  skipped: number;
  pct: number;
};
type CoverageSummary = {
  branches: CoverageEval;
  functions: CoverageEval;
  lines: CoverageEval;
  statements: CoverageEval;
};
type JsonSummary = {
  [key: string]: CoverageSummary;
} & {
  total: CoverageSummary;
};
type V8EndLocation = {
  line: number;
  column: number | null;
};
type V8Range = {
  start: Istanbul.Location;
  end: V8EndLocation;
};
type V8Function = {
  name: string;
  decl: V8Range;
  loc: V8Range;
  line: number;
};
type V8Branch = {
  line: number;
  type: string;
  locations: (Empty | V8Range)[];
  loc: V8Range;
};
type V8FileCoverageEntry = {
  path: string;
  statementMap: {
    [key: string]: V8Range;
  };
  fnMap: {
    [key: string]: V8Function;
  };
  branchMap: {
    [key: string]: V8Branch;
  };
  s: {
    [key: string]: number;
  };
  f: {
    [key: string]: number;
  };
  b: {
    [key: string]: number[];
  };
  meta: {
    lastBranch: number;
    lastFunction: number;
    lastStatement: number;
    seen: {
      [key: string]: number;
    };
  };
};
type Empty = Record<never, never>;
type V8CoverageMap = {
  [key: string]: V8FileCoverageEntry;
};
export declare const apiContract: import("hono/hono-base").HonoBase<import("hono/types").BlankEnv, import("hono/types").BlankSchema | import("hono/types").MergeSchemaPath<{
  "/auth/device": {
    $post: {
      output: {
        error: string;
      };
      outputFormat: "json";
      status: 502;
      input: {};
    } | {
      output: {
        deviceCode: string;
        userCode: string;
        verificationUri: string;
        expiresIn: number;
        interval: number;
      };
      outputFormat: "json";
      status: 200;
      input: {};
    };
  };
} & {
  "/auth/session": {
    $post: {
      output: {
        error: string;
      };
      outputFormat: "json";
      status: 202;
      input: {
        json: {
          deviceCode: string;
        };
      };
    } | {
      output: {
        error: string;
      };
      outputFormat: "json";
      status: 401;
      input: {
        json: {
          deviceCode: string;
        };
      };
    } | {
      output: {
        error: string;
      };
      outputFormat: "json";
      status: 502;
      input: {
        json: {
          deviceCode: string;
        };
      };
    } | {
      output: {
        token: string;
        expiresAt: number;
        account: {
          id: number;
          login: string;
        };
      };
      outputFormat: "json";
      status: 201;
      input: {
        json: {
          deviceCode: string;
        };
      };
    };
  };
} & {
  "/auth/session": {
    $delete: {
      output: {
        success: true;
      };
      outputFormat: "json";
      status: 200;
      input: {};
    };
  };
} & {
  "/account": {
    $get: {
      output: {
        id: number;
        login: string;
        role: "free";
        expiresAt: number;
        limits: {
          projects: number | null;
          reports: 0 | 3 | null;
          tokens: 0 | 12;
        };
      };
      outputFormat: "json";
      status: 200;
      input: {};
    };
  };
} & {
  "/projects": {
    $get: {
      output: {
        projects: {
          tokens: {
            createdAt: string & {
              __brand__: `ISO8601`;
            };
            id: string;
            name: string;
          }[];
          reports: {
            createdAt: string & {
              __brand__: `ISO8601`;
            };
            jsonSummary: (string & {
              json?: JsonSummary;
            }) | null;
            ref: string;
          }[];
          createdAt: string & {
            __brand__: `ISO8601`;
          };
          id: string;
          name: string;
          userId: number;
        }[];
      };
      outputFormat: "json";
      status: 200;
      input: {};
    };
  };
} & {
  "/projects": {
    $post: {
      output: {
        createdAt: string & {
          __brand__: `ISO8601`;
        };
        id: string;
        name: string;
        userId: number;
      };
      outputFormat: "json";
      status: 201;
      input: {
        json: {
          name: string;
        };
      };
    };
  };
} & {
  "/projects/:projectId/tokens": {
    $post: {
      output: {
        id: string;
        name: string;
        createdAt: string;
        token: string;
      };
      outputFormat: "json";
      status: 201;
      input: {
        json: {
          name: string;
        };
      } & {
        param: {
          projectId: string;
        };
      };
    };
  };
} & {
  "/projects/:projectId/tokens/:tokenId": {
    $delete: {
      output: {
        error: string;
      };
      outputFormat: "json";
      status: 404;
      input: {
        param: {
          projectId: string;
        } & {
          tokenId: string;
        };
      };
    } | {
      output: {
        success: true;
        id: string;
      };
      outputFormat: "json";
      status: 200;
      input: {
        param: {
          projectId: string;
        } & {
          tokenId: string;
        };
      };
    };
  };
} & {
  "/projects/:projectId": {
    $get: {
      output: {
        createdAt: string & {
          __brand__: `ISO8601`;
        };
        id: string;
        name: string;
        userId: number;
      };
      outputFormat: "json";
      status: 200;
      input: {
        param: {
          projectId: string;
        };
      };
    };
  };
} & {
  "/projects/:projectId": {
    $patch: {
      output: {
        createdAt: string & {
          __brand__: `ISO8601`;
        };
        id: string;
        name: string;
        userId: number;
      };
      outputFormat: "json";
      status: 200;
      input: {
        json: {
          name: string;
        };
      } & {
        param: {
          projectId: string;
        };
      };
    };
  };
} & {
  "/projects/:projectId": {
    $delete: {
      output: {
        success: true;
        id: string;
      };
      outputFormat: "json";
      status: 200;
      input: {
        param: {
          projectId: string;
        };
      };
    };
  };
} & {
  "/projects/:projectId/tokens": {
    $get: {
      output: {
        tokens: {
          createdAt: string & {
            __brand__: `ISO8601`;
          };
          id: string;
          name: string;
        }[];
      };
      outputFormat: "json";
      status: 200;
      input: {
        param: {
          projectId: string;
        };
      };
    };
  };
} & {
  "/projects/:projectId/reports": {
    $get: {
      output: {
        reports: {
          ref: string;
          createdAt: string;
          jsonSummary: {
            [x: string]: {
              branches: {
                total: number;
                covered: number;
                skipped: number;
                pct: number;
              };
              functions: {
                total: number;
                covered: number;
                skipped: number;
                pct: number;
              };
              lines: {
                total: number;
                covered: number;
                skipped: number;
                pct: number;
              };
              statements: {
                total: number;
                covered: number;
                skipped: number;
                pct: number;
              };
            };
            total: {
              branches: {
                total: number;
                covered: number;
                skipped: number;
                pct: number;
              };
              functions: {
                total: number;
                covered: number;
                skipped: number;
                pct: number;
              };
              lines: {
                total: number;
                covered: number;
                skipped: number;
                pct: number;
              };
              statements: {
                total: number;
                covered: number;
                skipped: number;
                pct: number;
              };
            };
          } | null;
        }[];
      };
      outputFormat: "json";
      status: 200;
      input: {
        param: {
          projectId: string;
        };
      };
    };
  };
} & {
  "/projects/:projectId/reports/:reportRef": {
    $get: {
      output: {
        ref: string;
        createdAt: string & {
          __brand__: `ISO8601`;
        };
        jsonSummary: {
          [x: string]: {
            branches: {
              total: number;
              covered: number;
              skipped: number;
              pct: number;
            };
            functions: {
              total: number;
              covered: number;
              skipped: number;
              pct: number;
            };
            lines: {
              total: number;
              covered: number;
              skipped: number;
              pct: number;
            };
            statements: {
              total: number;
              covered: number;
              skipped: number;
              pct: number;
            };
          };
          total: {
            branches: {
              total: number;
              covered: number;
              skipped: number;
              pct: number;
            };
            functions: {
              total: number;
              covered: number;
              skipped: number;
              pct: number;
            };
            lines: {
              total: number;
              covered: number;
              skipped: number;
              pct: number;
            };
            statements: {
              total: number;
              covered: number;
              skipped: number;
              pct: number;
            };
          };
        } | null;
      };
      outputFormat: "json";
      status: 200;
      input: {
        param: {
          projectId: string;
        } & {
          reportRef: string;
        };
      };
    };
  };
} & {
  "/projects/:projectId/reports/:reportRef/data": {
    $get: {
      output: {
        ref: string;
        mapData: {
          [x: string]: {
            path: string;
            statementMap: {
              [x: string]: {
                start: {
                  line: number;
                  column: number;
                };
                end: {
                  line: number;
                  column: number | null;
                };
              };
            };
            fnMap: {
              [x: string]: {
                name: string;
                decl: {
                  start: {
                    line: number;
                    column: number;
                  };
                  end: {
                    line: number;
                    column: number | null;
                  };
                };
                loc: {
                  start: {
                    line: number;
                    column: number;
                  };
                  end: {
                    line: number;
                    column: number | null;
                  };
                };
                line: number;
              };
            };
            branchMap: {
              [x: string]: {
                line: number;
                type: string;
                locations: ({
                  start: {
                    line: number;
                    column: number;
                  };
                  end: {
                    line: number;
                    column: number | null;
                  };
                } | {})[];
                loc: {
                  start: {
                    line: number;
                    column: number;
                  };
                  end: {
                    line: number;
                    column: number | null;
                  };
                };
              };
            };
            s: {
              [x: string]: number;
            };
            f: {
              [x: string]: number;
            };
            b: {
              [x: string]: number[];
            };
            meta: {
              lastBranch: number;
              lastFunction: number;
              lastStatement: number;
              seen: {
                [x: string]: number;
              };
            };
          };
        } | {
          [x: string]: {
            path: string;
            statementMap: {
              [x: string]: {
                start: {
                  line: number;
                  column: number;
                };
                end: {
                  line: number;
                  column: number;
                };
              };
            };
            fnMap: {
              [x: string]: {
                name: string;
                line: number;
                decl: {
                  start: {
                    line: number;
                    column: number;
                  };
                  end: {
                    line: number;
                    column: number;
                  };
                };
                loc: {
                  start: {
                    line: number;
                    column: number;
                  };
                  end: {
                    line: number;
                    column: number;
                  };
                };
              };
            };
            branchMap: {
              [x: string]: {
                line: number;
                type: string;
                locations: ({
                  start: {
                    line: number;
                    column: number;
                  };
                  end: {
                    line: number;
                    column: number;
                  };
                } | {
                  start: {};
                  end: {};
                })[];
                loc: {
                  start: {
                    line: number;
                    column: number;
                  };
                  end: {
                    line: number;
                    column: number;
                  };
                };
              };
            };
            s: {
              [x: string]: number;
            };
            f: {
              [x: string]: number;
            };
            b: {
              [x: string]: number[];
            };
          };
        };
      };
      outputFormat: "json";
      status: 200;
      input: {
        param: {
          projectId: string;
        } & {
          reportRef: string;
        };
      };
    };
  };
} & {
  "/projects/:projectId/reports/:reportRef": {
    $put: {
      output: {
        success: true;
        ref: string;
        jsonSummary: {
          [x: string]: {
            branches: {
              total: number;
              covered: number;
              skipped: number;
              pct: number;
            };
            functions: {
              total: number;
              covered: number;
              skipped: number;
              pct: number;
            };
            lines: {
              total: number;
              covered: number;
              skipped: number;
              pct: number;
            };
            statements: {
              total: number;
              covered: number;
              skipped: number;
              pct: number;
            };
          };
          total: {
            branches: {
              total: number;
              covered: number;
              skipped: number;
              pct: number;
            };
            functions: {
              total: number;
              covered: number;
              skipped: number;
              pct: number;
            };
            lines: {
              total: number;
              covered: number;
              skipped: number;
              pct: number;
            };
            statements: {
              total: number;
              covered: number;
              skipped: number;
              pct: number;
            };
          };
        };
      };
      outputFormat: "json";
      status: 200;
      input: {
        json: {
          mapData: V8CoverageMap | {
            [x: string]: {
              path: string;
              statementMap: {
                [x: string]: import("istanbul-lib-coverage").Range;
              };
              fnMap: {
                [x: string]: {
                  name: string;
                  line: number;
                  decl: import("istanbul-lib-coverage").Range;
                  loc: import("istanbul-lib-coverage").Range;
                };
              };
              branchMap: {
                [x: string]: {
                  line: number;
                  type: string;
                  locations: (import("istanbul-lib-coverage").Range | {
                    start: {};
                    end: {};
                  })[];
                  loc: import("istanbul-lib-coverage").Range;
                };
              };
              s: {
                [x: string]: number;
              };
              f: {
                [x: string]: number;
              };
              b: {
                [x: string]: number[];
              };
            };
          };
          jsonSummary: JsonSummary;
        };
      } & {
        param: {
          projectId: string;
        } & {
          reportRef: string;
        };
      };
    };
  };
} & {
  "/projects/:projectId/reports/:reportRef": {
    $delete: {
      output: {
        success: true;
        ref: string;
      };
      outputFormat: "json";
      status: 200;
      input: {
        param: {
          projectId: string;
        } & {
          reportRef: string;
        };
      };
    };
  };
} & {
  "/projects/:projectId/reports/:reportRef/badge": {
    $get: {
      output: {
        error: string;
      };
      outputFormat: "json";
      status: 409;
      input: {
        param: {
          projectId: string;
        } & {
          reportRef: string;
        };
      };
    } | {
      output: {
        endpoint: string;
        image: string;
        markdown: string;
      };
      outputFormat: "json";
      status: 200;
      input: {
        param: {
          projectId: string;
        } & {
          reportRef: string;
        };
      };
    };
  };
}, "/">, "/", "/">;
export {};
