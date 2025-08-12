import { useLoaderData, type RouteProps } from "./app_utils.ts";

export function Home(props: RouteProps<"/_index">) {
	const loaderData = useLoaderData(props);

	return (
		<>
			<h1>Welcome to River!</h1>
			<p>{loaderData.Message}</p>
		</>
	);
}
