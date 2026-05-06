const std = @import("std");
const converter = @import("converter.zig");

const Options = struct {
    mode: converter.Mode = .json_to_dtxt,
    input_path: ?[]const u8 = null,
    output_path: ?[]const u8 = null,
    indent: ?[]const u8 = "  ",
    wrap_key: []const u8 = "root",
    no_wrap: bool = false,
};

pub fn main(init: std.process.Init) !void {
    const allocator = init.gpa;
    const io = init.io;
    const args_vec = init.minimal.args.vector;

    const opts = parseArgs(allocator, io, args_vec[1..]);

    const input = try readInput(allocator, opts.input_path, io);
    defer allocator.free(input);

    const result = try converter.convert(allocator, input, .{
        .mode = opts.mode,
        .indent = opts.indent,
        .wrap_key = opts.wrap_key,
        .no_wrap = opts.no_wrap,
    });
    defer allocator.free(result);

    try writeOutput(result, opts.output_path, io);
}

fn parseArgs(allocator: std.mem.Allocator, io: std.Io, args_vec: []const [*:0]const u8) Options {
    _ = allocator;
    _ = io;
    var opts: Options = .{};
    var i: usize = 0;
    while (i < args_vec.len) : (i += 1) {
        const arg = std.mem.span(args_vec[i]);
        if (std.mem.eql(u8, arg, "-j") or std.mem.eql(u8, arg, "--json-to-dtxt")) {
            opts.mode = .json_to_dtxt;
        } else if (std.mem.eql(u8, arg, "-d") or std.mem.eql(u8, arg, "--dtxt-to-json")) {
            opts.mode = .dtxt_to_json;
        } else if (std.mem.eql(u8, arg, "-f") or std.mem.eql(u8, arg, "--format")) {
            opts.mode = .format;
        } else if (std.mem.eql(u8, arg, "-i") or std.mem.eql(u8, arg, "--input")) {
            i += 1;
            if (i >= args_vec.len) std.process.exit(1);
            opts.input_path = std.mem.span(args_vec[i]);
        } else if (std.mem.eql(u8, arg, "-o") or std.mem.eql(u8, arg, "--output")) {
            i += 1;
            if (i >= args_vec.len) std.process.exit(1);
            opts.output_path = std.mem.span(args_vec[i]);
        } else if (std.mem.eql(u8, arg, "--indent")) {
            i += 1;
            if (i >= args_vec.len) std.process.exit(1);
            opts.indent = std.mem.span(args_vec[i]);
        } else if (std.mem.eql(u8, arg, "--minify")) {
            opts.indent = null;
        } else if (std.mem.eql(u8, arg, "--wrap-key")) {
            i += 1;
            if (i >= args_vec.len) std.process.exit(1);
            opts.wrap_key = std.mem.span(args_vec[i]);
        } else if (std.mem.eql(u8, arg, "--no-wrap")) {
            opts.no_wrap = true;
        } else if (std.mem.eql(u8, arg, "-h") or std.mem.eql(u8, arg, "--help")) {
            printHelp();
            std.process.exit(0);
        } else if (std.mem.eql(u8, arg, "-v") or std.mem.eql(u8, arg, "--version")) {
            std.debug.print("dtxt-convert-zig 0.1.0\n", .{});
            std.process.exit(0);
        } else {
            if (opts.input_path == null) {
                opts.input_path = arg;
            } else {
                std.debug.print("Unknown argument: {s}\n", .{arg});
                std.process.exit(1);
            }
        }
    }
    return opts;
}

fn readInput(allocator: std.mem.Allocator, path: ?[]const u8, io: std.Io) ![]const u8 {
    if (path) |p| {
        const dir = std.Io.Dir.cwd();
        const file = try dir.openFile(io, p, .{});
        defer file.close(io);
        const stat = try file.stat(io);
        const buf = try allocator.alloc(u8, stat.size);
        errdefer allocator.free(buf);
        _ = try file.readPositionalAll(io, buf, 0);
        return buf;
    }
    const stdin_file = std.Io.File.stdin();
    var buf = std.ArrayList(u8).empty;
    errdefer buf.deinit(allocator);
    var chunk: [4096]u8 = undefined;
    while (true) {
        const n = stdin_file.readStreaming(io, &.{&chunk}) catch |err| switch (err) {
            error.EndOfStream => break,
            else => return err,
        };
        try buf.appendSlice(allocator, chunk[0..n]);
    }
    return buf.toOwnedSlice(allocator);
}

fn writeOutput(content: []const u8, path: ?[]const u8, io: std.Io) !void {
    if (path) |p| {
        const dir = std.Io.Dir.cwd();
        const file = try dir.createFile(io, p, .{});
        defer file.close(io);
        try file.writeStreamingAll(io, content);
    } else {
        const stdout_file = std.Io.File.stdout();
        try stdout_file.writeStreamingAll(io, content);
        if (content.len == 0 or content[content.len - 1] != '\n') {
            try stdout_file.writeStreamingAll(io, "\n");
        }
    }
}

fn printHelp() void {
    const help =
        \\
        \\DTXT Converter (Zig) — Convert between JSON and DTXT formats
        \\
        \\USAGE:
        \\  dtxt-convert [options] [input-file]
        \\
        \\MODES:
        \\  -j, --json-to-dtxt    Convert JSON to DTXT (default)
        \\  -d, --dtxt-to-json    Convert DTXT to JSON
        \\  -f, --format          Format/pretty-print a DTXT file
        \\
        \\INPUT/OUTPUT:
        \\  -i, --input <file>    Input file (or pass as positional arg)
        \\  -o, --output <file>   Output file (defaults to stdout)
        \\
        \\FORMATTING:
        \\  --indent <string>     Indentation string (default: "  ")
        \\  --minify              Remove all unnecessary whitespace
        \\
        \\ARRAY ROOTS:
        \\  DTXT requires root objects. Arrays/scalars are auto-wrapped:
        \\  --wrap-key <key>      Key name for wrapped root (default: "root")
        \\  --no-wrap             Error instead of wrapping (strict mode)
        \\
        \\OTHER:
        \\  -h, --help            Show this help message
        \\  -v, --version         Show version
        \\
        \\EXAMPLES:
        \\  dtxt-convert -j config.json -o config.dtxt
        \\  dtxt-convert -d config.dtxt -o config.json
        \\  dtxt-convert -f config.dtxt
        \\  cat data.json | dtxt-convert -j
        \\  dtxt-convert --json-to-dtxt --minify input.json
        \\
    ;
    std.debug.print("{s}", .{help});
}
