const dns = require("node:dns");

// Windows/local routers often fail mongodb+srv SRV lookups before app code runs.
// ipv4first helps Node fetches; Prisma still needs an IPv4-pinned host (see prisma.ts).
dns.setServers(["8.8.8.8", "1.1.1.1"]);
dns.setDefaultResultOrder("ipv4first");
