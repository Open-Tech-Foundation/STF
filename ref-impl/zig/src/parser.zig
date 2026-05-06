const std = @import("std");
const value = @import("value.zig");
const Value = value.Value;
const Error = value.Error;
const MAX_DEPTH = value.MAX_DEPTH;

pub const Parser = struct {
    input: []const u8,
    pos: usize = 0,
    depth: usize = 0,
    allocator: std.mem.Allocator,

    pub fn init(allocator: std.mem.Allocator, input: []const u8) Parser {
        return .{ .input = input, .allocator = allocator };
    }

    pub fn parse(self: *Parser) Error!Value {
        self.skipWhitespaceAndComments();
        while (self.current() == '@') {
            try self.parseDirective();
            self.skipWhitespaceAndComments();
        }
        const result = try self.parseObject();
        self.skipWhitespaceAndComments();
        if (self.pos < self.input.len) {
            return Error.TrailingData;
        }
        return result;
    }

    fn parseDirective(self: *Parser) Error!void {
        self.advance();
        while (self.pos < self.input.len and isAlpha(self.input[self.pos])) {
            self.pos += 1;
        }
        if (self.current() != '(') return Error.InvalidToken;
        self.advance();
        while (self.pos < self.input.len and self.input[self.pos] != ')') {
            self.pos += 1;
        }
        if (self.pos >= self.input.len) return Error.InvalidToken;
        self.advance();
    }

    fn current(self: *Parser) ?u8 {
        if (self.pos < self.input.len) return self.input[self.pos];
        return null;
    }

    fn advance(self: *Parser) void {
        self.pos += 1;
    }

    fn skipWhitespaceAndComments(self: *Parser) void {
        while (self.pos < self.input.len) {
            const ch = self.input[self.pos];
            if (ch == ' ' or ch == '\t' or ch == '\r' or ch == '\n') {
                self.pos += 1;
            } else if (ch == '#') {
                while (self.pos < self.input.len and self.input[self.pos] != '\n') {
                    self.pos += 1;
                }
            } else {
                break;
            }
        }
    }

    fn parseObject(self: *Parser) Error!Value {
        if (self.current() != '{') return Error.InvalidToken;
        self.advance();

        self.depth += 1;
        if (self.depth > MAX_DEPTH) return Error.NestingTooDeep;
        defer self.depth -= 1;

        var entries = std.ArrayList(Value.ObjectEntry).empty;
        defer {
            for (entries.items) |*e| {
                self.allocator.free(e.key);
                e.value.deinit(self.allocator);
            }
            entries.deinit(self.allocator);
        }

        self.skipWhitespaceAndComments();
        while (self.current() != '}') {
            const key = try self.parseKey();
            defer self.allocator.free(key);

            self.skipWhitespaceAndComments();
            if (self.current() != ':') return Error.ExpectedColon;
            self.advance();

            const val = try self.parseValue();
            errdefer val.deinit(self.allocator);

            for (entries.items) |existing| {
                if (std.mem.eql(u8, existing.key, key)) {
                    val.deinit(self.allocator);
                    for (entries.items) |*e| e.value.deinit(self.allocator);
                    return Error.DuplicateKey;
                }
            }

            try entries.append(self.allocator, .{ .key = try self.allocator.dupe(u8, key), .value = val });

            self.skipWhitespaceAndComments();
            if (self.current() == ',') {
                self.advance();
                self.skipWhitespaceAndComments();
            } else if (self.current() != '}') {
                return Error.ExpectedCommaOrClose;
            }
        }

        self.advance();

        const slice = try entries.toOwnedSlice(self.allocator);
        errdefer {
            for (slice) |*e| e.value.deinit(self.allocator);
            self.allocator.free(slice);
        }

        value.sortEntries(slice);

        return .{ .Object = slice };
    }

    fn parseKey(self: *Parser) Error![]const u8 {
        const start = self.pos;
        while (self.pos < self.input.len and isKeyChar(self.input[self.pos])) {
            self.pos += 1;
        }
        if (start == self.pos) return Error.InvalidToken;
        return self.allocator.dupe(u8, self.input[start..self.pos]);
    }

    fn isKeyChar(ch: u8) bool {
        return (ch >= 'a' and ch <= 'z') or
            (ch >= 'A' and ch <= 'Z') or
            (ch >= '0' and ch <= '9') or
            ch == '_' or ch == '-';
    }

    fn parseValue(self: *Parser) Error!Value {
        self.skipWhitespaceAndComments();
        const ch = self.current() orelse return Error.UnexpectedEnd;

        if (ch == '{') return self.parseObject();
        if (ch == '[') return self.parseArray();
        if (ch == '`') return self.parseRawString();
        if (ch == '"') return self.parseInterpretedString();
        if (ch == '-' or (ch >= '0' and ch <= '9')) return self.parseNumber();
        if (ch == 'T' or ch == 'F' or ch == 'N') {
            return self.parseLiteralOrConstructor(ch);
        }
        if (isAlpha(ch)) return self.parseConstructor();
        return Error.InvalidToken;
    }

    fn parseLiteralOrConstructor(self: *Parser, first: u8) Error!Value {
        _ = first;
        const name_start = self.pos;
        while (self.pos < self.input.len and isAlpha(self.input[self.pos])) {
            self.pos += 1;
        }
        const type_name = self.input[name_start..self.pos];

        if (self.current() == '(') {
            self.pos = name_start;
            return self.parseConstructor();
        }

        if (std.mem.eql(u8, type_name, "T")) return .{ .Bool = true };
        if (std.mem.eql(u8, type_name, "F")) return .{ .Bool = false };
        if (std.mem.eql(u8, type_name, "N")) return .Null;
        return Error.InvalidToken;
    }

    fn parseArray(self: *Parser) Error!Value {
        if (self.current() != '[') return Error.InvalidToken;
        self.advance();

        self.depth += 1;
        if (self.depth > MAX_DEPTH) return Error.NestingTooDeep;
        defer self.depth -= 1;

        var items = std.ArrayList(Value).empty;
        defer items.deinit(self.allocator);

        self.skipWhitespaceAndComments();
        while (self.current() != ']') {
            const item = try self.parseValue();
            try items.append(self.allocator, item);

            self.skipWhitespaceAndComments();
            if (self.current() == ',') {
                self.advance();
                self.skipWhitespaceAndComments();
            } else if (self.current() != ']') {
                return Error.ExpectedCommaOrClose;
            }
        }

        self.advance();
        return .{ .Array = try items.toOwnedSlice(self.allocator) };
    }

    fn parseRawString(self: *Parser) Error!Value {
        self.advance();
        const start = self.pos;
        while (self.pos < self.input.len and self.input[self.pos] != '`') {
            self.pos += 1;
        }
        if (self.pos >= self.input.len) return Error.InvalidString;
        const result = try self.allocator.dupe(u8, self.input[start..self.pos]);
        errdefer self.allocator.free(result);
        self.advance();
        return .{ .String = result };
    }

    fn parseInterpretedString(self: *Parser) Error!Value {
        self.advance();
        var buf = std.ArrayList(u8).empty;
        defer buf.deinit(self.allocator);

        while (self.pos < self.input.len and self.input[self.pos] != '"') {
            const ch = self.input[self.pos];
            if (ch == '\n' or ch == '\r') return Error.InvalidString;
            if (ch == '\\') {
                self.advance();
                if (self.pos >= self.input.len) return Error.InvalidString;
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
                        if (self.pos + 4 >= self.input.len) return Error.InvalidString;
                        const hex_str = self.input[self.pos + 1 .. self.pos + 5];
                        const cp = try parseHex4(hex_str);
                        var out_buf: [4]u8 = undefined;
                        const len = std.unicode.utf8Encode(cp, &out_buf) catch return Error.InvalidString;
                        try buf.appendSlice(self.allocator, out_buf[0..len]);
                        self.pos += 4;
                    },
                    else => return Error.InvalidEscape,
                }
                self.advance();
                continue;
            }
            try buf.append(self.allocator, self.input[self.pos]);
            self.advance();
        }
        if (self.pos >= self.input.len) return Error.InvalidString;
        self.advance();

        return .{ .String = try buf.toOwnedSlice(self.allocator) };
    }

    fn parseHex4(str: []const u8) Error!u21 {
        var result: u21 = 0;
        for (str) |ch| {
            result <<= 4;
            switch (ch) {
                '0'...'9' => result |= (ch - '0'),
                'a'...'f' => result |= (ch - 'a' + 10),
                'A'...'F' => result |= (ch - 'A' + 10),
                else => return Error.InvalidString,
            }
        }
        return result;
    }

    fn parseNumber(self: *Parser) Error!Value {
        const start = self.pos;
        if (self.input[self.pos] == '0' and
            self.pos + 1 < self.input.len and
            self.input[self.pos + 1] >= '0' and
            self.input[self.pos + 1] <= '9')
        {
            return Error.InvalidNumber;
        }

        while (self.pos < self.input.len) {
            const ch = self.input[self.pos];
            if (ch == '.' or ch == '-' or ch == 'e' or ch == 'E' or (ch >= '0' and ch <= '9')) {
                self.pos += 1;
            } else {
                break;
            }
        }

        const num_str = self.input[start..self.pos];
        if (num_str.len == 0 or (num_str.len == 1 and num_str[0] == '-')) return Error.InvalidNumber;
        if (num_str[num_str.len - 1] == '.') return Error.InvalidNumber;

        const num = std.fmt.parseFloat(f64, num_str) catch return Error.InvalidNumber;
        return .{ .Number = num };
    }

    fn isAlpha(ch: u8) bool {
        return (ch >= 'a' and ch <= 'z') or (ch >= 'A' and ch <= 'Z') or ch == '_' or ch == '-';
    }

    fn parseConstructor(self: *Parser) Error!Value {
        const name_start = self.pos;
        while (self.pos < self.input.len and isAlpha(self.input[self.pos])) {
            self.pos += 1;
        }
        const type_name = self.input[name_start..self.pos];

        if (self.current() != '(') return Error.InvalidConstructor;
        self.advance();

        const payload_start = self.pos;
        while (self.pos < self.input.len and self.input[self.pos] != ')') {
            if (self.input[self.pos] == '(') return Error.InvalidConstructor;
            self.pos += 1;
        }
        const payload = self.input[payload_start..self.pos];

        if (self.current() != ')') return Error.InvalidConstructor;
        self.advance();

        if (std.mem.eql(u8, type_name, "Date")) {
            return self.validateDate(payload);
        } else if (std.mem.eql(u8, type_name, "BigNumber")) {
            return self.parseBigNumber(payload);
        } else if (std.mem.eql(u8, type_name, "Binary")) {
            return self.parseBinary(payload);
        } else {
            return Error.UnknownConstructor;
        }
    }

    fn hasPayloadWhitespace(payload: []const u8) bool {
        for (payload) |ch| {
            if (ch == ' ' or ch == '\t' or ch == '\r' or ch == '\n') return true;
        }
        return false;
    }

    fn validateDate(self: *Parser, payload: []const u8) Error!Value {
        if (payload.len == 0) return Error.InvalidDate;

        var i: usize = 0;
        var j: usize = 0;

        const year = parseDigits(payload, &i, 4) orelse return Error.InvalidDate;
        if (i >= payload.len or payload[i] != '-') return Error.InvalidDate;
        i += 1;
        const month = parseDigits(payload, &i, 2) orelse return Error.InvalidDate;
        if (i >= payload.len or payload[i] != '-') return Error.InvalidDate;
        i += 1;
        const day = parseDigits(payload, &i, 2) orelse return Error.InvalidDate;

        if (month < 1 or month > 12) return Error.InvalidDate;
        if (day < 1 or day > 31) return Error.InvalidDate;
        _ = year;

        if (i < payload.len and (payload[i] == 'T' or payload[i] == ' ')) {
            i += 1;
            j = 0;
            while (j < 2) : (j += 1) {
                if (i >= payload.len or payload[i] < '0' or payload[i] > '9') return Error.InvalidDate;
                i += 1;
            }
            if (i >= payload.len or payload[i] != ':') return Error.InvalidDate;
            i += 1;
            j = 0;
            while (j < 2) : (j += 1) {
                if (i >= payload.len or payload[i] < '0' or payload[i] > '9') return Error.InvalidDate;
                i += 1;
            }
            if (i >= payload.len or payload[i] != ':') return Error.InvalidDate;
            i += 1;
            j = 0;
            while (j < 2) : (j += 1) {
                if (i >= payload.len or payload[i] < '0' or payload[i] > '9') return Error.InvalidDate;
                i += 1;
            }
            if (i < payload.len and payload[i] == '.') {
                i += 1;
                while (i < payload.len and payload[i] >= '0' and payload[i] <= '9') i += 1;
            }
            if (i < payload.len and payload[i] == 'Z') {
                i += 1;
            } else if (i < payload.len and (payload[i] == '+' or payload[i] == '-')) {
                i += 1;
                j = 0;
                while (j < 2) : (j += 1) {
                    if (i >= payload.len or payload[i] < '0' or payload[i] > '9') return Error.InvalidDate;
                    i += 1;
                }
                if (i >= payload.len or payload[i] != ':') return Error.InvalidDate;
                i += 1;
                j = 0;
                while (j < 2) : (j += 1) {
                    if (i >= payload.len or payload[i] < '0' or payload[i] > '9') return Error.InvalidDate;
                    i += 1;
                }
            }
        }

        if (i != payload.len) return Error.InvalidDate;

        return .{ .Date = try self.allocator.dupe(u8, payload) };
    }

    fn parseDigits(s: []const u8, idx: *usize, count: usize) ?u32 {
        var result: u32 = 0;
        var j: usize = 0;
        while (j < count) : (j += 1) {
            if (idx.* >= s.len or s[idx.*] < '0' or s[idx.*] > '9') return null;
            result = result * 10 + (s[idx.*] - '0');
            idx.* += 1;
        }
        return result;
    }

    fn parseBigNumber(self: *Parser, payload: []const u8) Error!Value {
        if (payload.len == 0) return Error.InvalidBigNumber;
        if (hasPayloadWhitespace(payload)) return Error.InvalidConstructorPayload;
        var idx: usize = 0;
        if (payload[0] == '+' or payload[0] == '-') idx = 1;
        if (idx >= payload.len) return Error.InvalidBigNumber;
        while (idx < payload.len) : (idx += 1) {
            if (payload[idx] < '0' or payload[idx] > '9') return Error.InvalidBigNumber;
        }
        return .{ .BigNumber = try self.allocator.dupe(u8, payload) };
    }

    fn parseBinary(self: *Parser, payload: []const u8) Error!Value {
        if (payload.len == 0) return Error.InvalidBinary;
        if (hasPayloadWhitespace(payload)) return Error.InvalidConstructorPayload;
        var cleaned = std.ArrayList(u8).empty;
        defer cleaned.deinit(self.allocator);
        for (payload) |ch| {
            try cleaned.append(self.allocator, std.ascii.toUpper(ch));
        }
        const s = cleaned.items;
        if (s.len % 2 != 0) return Error.InvalidBinary;
        for (s) |ch| {
            if (!std.ascii.isHex(ch)) return Error.InvalidBinary;
        }
        return .{ .Binary = try self.allocator.dupe(u8, s) };
    }
};
