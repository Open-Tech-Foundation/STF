const std = @import("std");
const converter = @import("converter.zig");
const dtxt_parser = @import("parser.zig");
const stringify = @import("stringify.zig");
const json = @import("json.zig");
const json_stringify = @import("json_stringify.zig");

const BENCH_JSON = "../../benchmarks/zig/bench_v2.json";
const BENCH_DTXT = "../../benchmarks/zig/bench_v2.dtxt";

fn nsToMs(ns: i96) f64 {
    return @as(f64, @floatFromInt(ns)) / 1_000_000.0;
}

pub fn main(init: std.process.Init) !void {
    const allocator = std.heap.ArenaAllocator.allocator(init.arena);
    const io = init.io;
    const clock = std.Io.Clock.awake;

    std.debug.print("Loading benchmark data...\n", .{});
    const json_minified = try readFile(allocator, BENCH_JSON, io);

    // Generate pretty-printed JSON for fair size comparison
    const json_pretty = blk: {
        var jp_tmp = json.JsonParser.init(allocator, json_minified);
        var parsed_json = try jp_tmp.parse();
        defer parsed_json.deinit(allocator);
        break :blk try json_stringify.stringifyJson(parsed_json, allocator, "  ");
    };

    std.debug.print("JSON (minified) size: {d} bytes ({d} MB)\n", .{ json_minified.len, @as(f64, @floatFromInt(json_minified.len)) / 1024.0 / 1024.0 });
    std.debug.print("JSON (pretty) size:   {d} bytes ({d} MB)\n\n", .{ json_pretty.len, @as(f64, @floatFromInt(json_pretty.len)) / 1024.0 / 1024.0 });

    const dtxt_pretty = try converter.convert(allocator, json_minified, .{
        .mode = .json_to_dtxt,
        .indent = "  ",
    });
    const dtxt_minified = try converter.convert(allocator, json_minified, .{
        .mode = .json_to_dtxt,
        .indent = null,
    });

    const dtxt_pretty_mb = @as(f64, @floatFromInt(dtxt_pretty.len)) / 1024.0 / 1024.0;
    std.debug.print("DTXT (pretty) size:   {d} bytes ({d} MB)\n", .{ dtxt_pretty.len, dtxt_pretty_mb });
    const dtxt_minified_mb = @as(f64, @floatFromInt(dtxt_minified.len)) / 1024.0 / 1024.0;
    std.debug.print("DTXT (minified) size: {d} bytes ({d} MB)\n", .{ dtxt_minified.len, dtxt_minified_mb });
    const reduction_vs_pretty = (1.0 - @as(f64, @floatFromInt(dtxt_pretty.len)) / @as(f64, @floatFromInt(json_pretty.len))) * 100.0;
    std.debug.print("vs pretty JSON:       {d}%\n", .{reduction_vs_pretty});
    const reduction_vs_minified = (1.0 - @as(f64, @floatFromInt(dtxt_minified.len)) / @as(f64, @floatFromInt(json_minified.len))) * 100.0;
    std.debug.print("vs minified JSON:     {d}%\n\n", .{reduction_vs_minified});

    try writeFile(dtxt_pretty, BENCH_DTXT, io);

    const iterations = 5;

    {
        var total_ns: i96 = 0;
        var i: usize = 0;
        while (i < iterations) : (i += 1) {
            const start = clock.now(io);
            const result = try converter.convert(allocator, json_minified, .{
                .mode = .json_to_dtxt,
                .indent = "  ",
            });
            defer allocator.free(result);
            const end = clock.now(io);
            total_ns += start.durationTo(end).nanoseconds;
        }
        const avg_ms = nsToMs(@divTrunc(total_ns, @as(i96, @intCast(iterations))));
        std.debug.print("JSON -> DTXT conversion (avg of {d} runs): {d} ms\n", .{ iterations, avg_ms });
    }

    {
        var total_ns: i96 = 0;
        var i: usize = 0;
        while (i < iterations) : (i += 1) {
            const start = clock.now(io);
            const result = try converter.convert(allocator, dtxt_pretty, .{
                .mode = .dtxt_to_json,
                .indent = "  ",
            });
            defer allocator.free(result);
            const end = clock.now(io);
            total_ns += start.durationTo(end).nanoseconds;
        }
        const avg_ms = nsToMs(@divTrunc(total_ns, @as(i96, @intCast(iterations))));
        std.debug.print("DTXT -> JSON conversion (avg of {d} runs): {d} ms\n", .{ iterations, avg_ms });
    }

    {
        var total_ns: i96 = 0;
        var i: usize = 0;
        while (i < iterations) : (i += 1) {
            const start = clock.now(io);
            const result = try converter.convert(allocator, dtxt_pretty, .{
                .mode = .format,
                .indent = "  ",
            });
            defer allocator.free(result);
            const end = clock.now(io);
            total_ns += start.durationTo(end).nanoseconds;
        }
        const avg_ms = nsToMs(@divTrunc(total_ns, @as(i96, @intCast(iterations))));
        std.debug.print("DTXT format (avg of {d} runs): {d} ms\n\n", .{ iterations, avg_ms });
    }

    {
        var total_ns: i96 = 0;
        var i: usize = 0;
        while (i < iterations) : (i += 1) {
            const start = clock.now(io);
            var jp = json.JsonParser.init(allocator, json_minified);
            var parsed = try jp.parse();
            parsed.deinit(allocator);
            const end = clock.now(io);
            total_ns += start.durationTo(end).nanoseconds;
        }
        const avg_ms = nsToMs(@divTrunc(total_ns, @as(i96, @intCast(iterations))));
        std.debug.print("JSON parse only (avg of {d} runs): {d} ms\n", .{ iterations, avg_ms });
    }

    {
        var jp = json.JsonParser.init(allocator, json_minified);
        var parsed = try jp.parse();
        defer parsed.deinit(allocator);

        var total_ns: i96 = 0;
        var i: usize = 0;
        while (i < iterations) : (i += 1) {
            const start = clock.now(io);
            const result = try json_stringify.stringifyJson(parsed, allocator, "  ");
            defer allocator.free(result);
            const end = clock.now(io);
            total_ns += start.durationTo(end).nanoseconds;
        }
        const avg_ms = nsToMs(@divTrunc(total_ns, @as(i96, @intCast(iterations))));
        std.debug.print("JSON stringify only (avg of {d} runs): {d} ms\n", .{ iterations, avg_ms });
    }

    {
        var total_ns: i96 = 0;
        var i: usize = 0;
        while (i < iterations) : (i += 1) {
            const start = clock.now(io);
            var dp = dtxt_parser.Parser.init(allocator, dtxt_pretty);
            const parsed = try dp.parse();
            parsed.deinit(allocator);
            const end = clock.now(io);
            total_ns += start.durationTo(end).nanoseconds;
        }
        const avg_ms = nsToMs(@divTrunc(total_ns, @as(i96, @intCast(iterations))));
        std.debug.print("DTXT parse only (avg of {d} runs): {d} ms\n", .{ iterations, avg_ms });
    }

    {
        var dp = dtxt_parser.Parser.init(allocator, dtxt_pretty);
        const parsed = try dp.parse();
        defer parsed.deinit(allocator);

        var total_ns: i96 = 0;
        var i: usize = 0;
        while (i < iterations) : (i += 1) {
            const start = clock.now(io);
            const result = try stringify.stringify(parsed, allocator, "  ");
            defer allocator.free(result);
            const end = clock.now(io);
            total_ns += start.durationTo(end).nanoseconds;
        }
        const avg_ms = nsToMs(@divTrunc(total_ns, @as(i96, @intCast(iterations))));
        std.debug.print("DTXT stringify only (avg of {d} runs): {d} ms\n", .{ iterations, avg_ms });
    }
}

fn readFile(allocator: std.mem.Allocator, path: []const u8, io: std.Io) ![]const u8 {
    const dir = std.Io.Dir.cwd();
    const file = try dir.openFile(io, path, .{});
    defer file.close(io);
    const stat = try file.stat(io);
    const buf = try allocator.alloc(u8, stat.size);
    _ = try file.readPositionalAll(io, buf, 0);
    return buf;
}

fn writeFile(content: []const u8, path: []const u8, io: std.Io) !void {
    const dir = std.Io.Dir.cwd();
    const file = try dir.createFile(io, path, .{});
    defer file.close(io);
    try file.writeStreamingAll(io, content);
}
