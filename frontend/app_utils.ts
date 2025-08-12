import {
	makeTypedAddClientLoader,
	makeTypedUseLoaderData,
	makeTypedUsePatternLoaderData,
	makeTypedUseRouterData,
	type RiverRouteProps,
} from "river.now/react";
import type { RiverLoader, RiverLoaderPattern, RiverRootData } from "./river.gen.ts";

export type RouteProps<P extends RiverLoaderPattern> = RiverRouteProps<RiverLoader, P>;

export const useRouterData = makeTypedUseRouterData<RiverLoader, RiverRootData>();
export const useLoaderData = makeTypedUseLoaderData<RiverLoader>();
export const addClientLoader = makeTypedAddClientLoader<RiverLoader, RiverRootData>();
export const usePatternLoaderData = makeTypedUsePatternLoaderData<RiverLoader>();
