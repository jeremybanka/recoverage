// Generated from recoverage.cloud/src/api.ts. Run bun run --cwd recoverage.cloud gen:api.
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
export declare const apiContract: import("hono/hono-base").HonoBase<import("hono/types").BlankEnv, import("hono/types").BlankSchema | import("hono/types").MergeSchemaPath<{
  "/auth/device": {
    $post: {
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
    } | {
      output: {
        error: string;
      };
      outputFormat: "json";
      status: 502;
      input: {};
    };
  };
} & {
  "/auth/session": {
    $post: {
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
    } | {
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
    } | {
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
    };
  };
}, "/">, "/", "/">;
export {};
