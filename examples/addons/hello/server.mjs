// The add-on's server code. Pixel Pals imports this file and calls what it exports.
// ctx.storage.get(key) / ctx.storage.set(key, value)  needs the "storage" permission
// ctx.notify(title, text)                              needs the "notify" permission
// ctx.log(text)                                        writes to Pixel Pals' server log
export default {
  // Slash commands: type /hello Ann in the chat box. Return the text to show.
  commands: {
    async hello(args, ctx) {
      const n = ((await ctx.storage.get("count")) ?? 0) + 1;
      await ctx.storage.set("count", n);
      return `Hello ${args.trim() || "there"}! That's hello number ${n}.`;
    },
  },
  // Functions the add-on's window can call with pp.call("name", args).
  api: {
    async count(_args, ctx) { return (await ctx.storage.get("count")) ?? 0; },
    async bump(_args, ctx) { const n = ((await ctx.storage.get("count")) ?? 0) + 1; await ctx.storage.set("count", n); return n; },
  },
  // Background jobs named in addon.json.
  jobs: {
    async tick(ctx) { ctx.log("hello add-on: tick"); },
  },
};
