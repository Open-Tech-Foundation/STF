const std = @import("std");
const value = @import("value.zig");
const Value = value.Value;
const Error = value.Error;

pub const JsonParser = struct {
    input: []const u8,
    pos: usize = 0,
    allocator: std.mem.Allocator,

    pub fn init(allocator: std.mem.Allocator, input: []const u8) JsonParser {
        return .{ .input = input, .allocator = allocator };
    }

    pub fn parse(self: *JsonParser) Error!Value {
        self.skipWhitespace();
        const result = try self.parseValue();
        self.skipWhitespace();
        if (self.pos < self.input.len) return Error.TrailingData;
        return result;
    }

    fn current(self: *JsonParser) ?u8 {
        if (self.pos < self.input.len) return self.input[self.pos];
        return null;
    }

    fn skipWhitespace(self: *JsonParser) void {
        while (self.pos < self.input.len) {
            const ch = self.input[self.pos];
            if (ch == ' ' or ch == '\t' or ch == '\r' or ch == '\n') {
                self.pos += 1;
            } else {
                break;
            }
        }
    }

    fn parseValue(self: *JsonParser) Error!Value {
        self.skipWhitespace();
        const ch = self.current() orelse return Error.UnexpectedEnd;
        switch (ch) {
            '{' => return self.parseObject(),
            '[' => return self.parseArray(),
            '"' => return self.parseString(),
            't' => {
                if (self.pos + 4 <= self.input.len and
                    std.mem.eql(u8, self.input[self.pos .. self.pos + 4], "true"))
                {
                    self.pos += 4;
                    return .{ .Bool = true };
                }
                return Error.InvalidJson;
            },
            'f' => {
                if (self.pos + 5 <= self.input.len and
                    std.mem.eql(u8, self.input[self.pos .. self.pos + 5], "false"))
                {
                    self.pos += 5;
                    return .{ .Bool = false };
                }
                return Error.InvalidJson;
            },
            'n' => {
                if (self.pos + 4 <= self.input.len and
                    std.mem.eql(u8, self.input[self.pos .. self.pos + 4], "null"))
                {
                    self.pos += 4;
                    return .Null;
                }
                return Error.InvalidJson;
            },
            '-', '0'...'9' => return self.parseNumber(),
            else => return Error.InvalidJson,
        }
    }

    fn parseObject(self: *JsonParser) Error!Value {
        self.advance();
        var entries = std.ArrayList(Value.ObjectEntry).empty;
        defer entries.deinit(self.allocator);

        self.skipWhitespace();
        if (self.current() == '}') {
            self.advance();
            return .{ .Object = try entries.toOwnedSlice(self.allocator) };
        }

        while (true) {
            self.skipWhitespace();
            if (self.current() != '"') return Error.InvalidJson;
            const key = try self.parseJsonString();

            self.skipWhitespace();
            if (self.current() != ':') return Error.InvalidJson;
            self.advance();

            const val = try self.parseValue();
            try entries.append(self.allocator, .{ .key = key, .value = val });

            self.skipWhitespace();
            if (self.current() == ',') {
                self.advance();
            } else if (self.current() == '}') {
                self.advance();
                break;
            } else {
                return Error.InvalidJson;
            }
        }

        return .{ .Object = try entries.toOwnedSlice(self.allocator) };
    }

    fn parseArray(self: *JsonParser) Error!Value {
        self.advance();
        var items = std.ArrayList(Value).empty;
        defer items.deinit(self.allocator);

        self.skipWhitespace();
        if (self.current() == ']') {
            self.advance();
            return .{ .Array = try items.toOwnedSlice(self.allocator) };
        }

        while (true) {
            const item = try self.parseValue();
            try items.append(self.allocator, item);

            self.skipWhitespace();
            if (self.current() == ',') {
                self.advance();
            } else if (self.current() == ']') {
                self.advance();
                break;
            } else {
                return Error.InvalidJson;
            }
        }

        return .{ .Array = try items.toOwnedSlice(self.allocator) };
    }

    fn parseJsonString(self: *JsonParser) Error![]const u8 {
        self.advance();
        var buf = std.ArrayList(u8).empty;
        defer buf.deinit(self.allocator);

        while (self.pos < self.input.len and self.input[self.pos] != '"') {
            if (self.input[self.pos] == '\\') {
                self.advance();
                if (self.pos >= self.input.len) return Error.InvalidJson;
                const esc = self.input[self.pos];
                switch (esc) {
                    '"' => try buf.append(self.allocator, '"'),
                    '\\' => try buf.append(self.allocator, '\\'),
                    '/' => try buf.append(self.allocator, '/'),
                    'b' => try buf.append(self.allocator, '\x08'),
                    'f' => try buf.append(self.allocator, '\x0C'),
                    'n' => try buf.append(self.allocator, '\n'),
                    'r' => try buf.append(self.allocator, '\r'),
                    't' => try buf.append(self.allocator, '\t'),
                    'u' => {
                        if (self.pos + 4 >= self.input.len) return Error.InvalidJson;
                        const hex_str = self.input[self.pos + 1 .. self.pos + 5];
                        var cp: u21 = 0;
                        for (hex_str) |ch| {
                            cp <<= 4;
                            switch (ch) {
                                '0'...'9' => cp |= (ch - '0'),
                                'a'...'f' => cp |= (ch - 'a' + 10),
                                'A'...'F' => cp |= (ch - 'A' + 10),
                                else => return Error.InvalidJson,
                            }
                        }
                        var out_buf: [4]u8 = undefined;
                        const len = std.unicode.utf8Encode(cp, &out_buf) catch return Error.InvalidJson;
                        try buf.appendSlice(self.allocator, out_buf[0..len]);
                        self.pos += 4;
                    },
                    else => return Error.InvalidJson,
                }
                self.advance();
                continue;
            }
            try buf.append(self.allocator, self.input[self.pos]);
            self.advance();
        }
        if (self.pos >= self.input.len) return Error.InvalidJson;
        self.advance();
        return buf.toOwnedSlice(self.allocator);
    }

    fn parseString(self: *JsonParser) Error!Value {
        return .{ .String = try self.parseJsonString() };
    }

    fn parseNumber(self: *JsonParser) Error!Value {
        const start = self.pos;
        while (self.pos < self.input.len) {
            const ch = self.input[self.pos];
            if (ch == '.' or ch == '-' or ch == 'e' or ch == 'E' or (ch >= '0' and ch <= '9')) {
                self.pos += 1;
            } else {
                break;
            }
        }
        const num_str = self.input[start..self.pos];
        const num = std.fmt.parseFloat(f64, num_str) catch return Error.InvalidJson;
        return .{ .Number = num };
    }

    fn advance(self: *JsonParser) void {
        self.pos += 1;
    }
};
