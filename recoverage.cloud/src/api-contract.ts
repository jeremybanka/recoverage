import { Hono } from "hono"

import { apiRoutes } from "./api"

// Retain the inferred route schema without exposing Worker bindings to clients.
export const apiContract = new Hono().route(`/`, apiRoutes)
