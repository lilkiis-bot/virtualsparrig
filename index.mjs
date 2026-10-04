import { PeerServer } from "peer";
const port = Number(process.env.PORT || 9000);
const server = PeerServer({
  port,
  host: "0.0.0.0",
  path: "/octagon",
  proxied: process.env.BEHIND_PROXY === "true",
  allow_discovery: false,
  concurrent_limit: 200,
  alive_timeout: 60000,
});
server.on("connection", () => console.log("Peer connected"));
server.on("disconnect", () => console.log("Peer disconnected"));
console.log(
  `OCTAGON signaling on port ${port}. Use an HTTPS/WSS reverse proxy for public access.`,
);
