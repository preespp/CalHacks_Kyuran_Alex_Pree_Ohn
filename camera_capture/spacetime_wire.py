# BSATN 2.13 codec reused from ../../camera_stream/camera_stream.py.
# ClientMessage variant order matches the SpacetimeDB 2.13 websocket schema.
TAG_SUBSCRIBE = 0
TAG_CALL_REDUCER = 3

# ServerMessage variants.
TAG_INITIAL_CONNECTION = 0
TAG_SUBSCRIBE_APPLIED = 1
TAG_UNSUBSCRIBE_APPLIED = 2
TAG_SUBSCRIPTION_ERROR = 3
TAG_TRANSACTION_UPDATE = 4
TAG_ONE_OFF_QUERY_RESULT = 5
TAG_REDUCER_RESULT = 6
TAG_PROCEDURE_RESULT = 7
TAG_SUBSCRIBE_BATCH_APPLIED = 8


class BsatnError(Exception):
    pass


class Reader:
    def __init__(self, data: bytes, offset: int = 0) -> None:
        self.data = data
        self.i = offset

    def remaining(self) -> int:
        return len(self.data) - self.i

    def take(self, n: int) -> bytes:
        if n < 0 or self.i + n > len(self.data):
            raise BsatnError(
                f"need {n} bytes at {self.i}, have {self.remaining()}"
            )
        chunk = self.data[self.i : self.i + n]
        self.i += n
        return chunk

    def u8(self) -> int:
        return self.take(1)[0]

    def u16(self) -> int:
        return int.from_bytes(self.take(2), "little")

    def u32(self) -> int:
        return int.from_bytes(self.take(4), "little")

    def u64(self) -> int:
        return int.from_bytes(self.take(8), "little")

    def i64(self) -> int:
        return int.from_bytes(self.take(8), "little", signed=True)

    def string(self) -> str:
        return self.take(self.u32()).decode("utf-8", errors="replace")

    def byte_array(self) -> bytes:
        return self.take(self.u32())


class Writer:
    def __init__(self) -> None:
        self.buf = bytearray()

    def u8(self, value: int) -> None:
        self.buf.append(value & 0xFF)

    def u32(self, value: int) -> None:
        self.buf += int(value).to_bytes(4, "little")

    def raw(self, data: bytes) -> None:
        self.buf += data

    def string(self, value: str) -> None:
        encoded = value.encode("utf-8")
        self.u32(len(encoded))
        self.raw(encoded)

    def byte_array(self, data: bytes) -> None:
        self.u32(len(data))
        self.raw(data)

    def finish(self) -> bytes:
        return bytes(self.buf)


def encode_subscribe(request_id: int, query_set_id: int, sql: str) -> bytes:
    writer = Writer()
    writer.u8(TAG_SUBSCRIBE)
    writer.u32(request_id)
    writer.u32(query_set_id)
    writer.u32(1)
    writer.string(sql)
    return writer.finish()


def read_size_hint(reader: Reader) -> None:
    tag = reader.u8()
    if tag == 0:
        reader.u16()
    elif tag == 1:
        count = reader.u32()
        reader.take(count * 8)
    else:
        raise BsatnError(f"unknown row size hint {tag}")


def read_row_list(reader: Reader) -> bytes:
    read_size_hint(reader)
    return reader.byte_array()


def read_query_rows(reader: Reader) -> list[tuple[str, bytes]]:
    tables = []
    for _ in range(reader.u32()):
        name = reader.string()
        tables.append((name, read_row_list(reader)))
    return tables


def read_option_query_rows(reader: Reader) -> None:
    tag = reader.u8()
    if tag == 0:
        read_query_rows(reader)
    elif tag != 1:
        raise BsatnError(f"unknown option tag {tag}")


def read_table_updates(reader: Reader) -> list[tuple[str, str, bytes]]:
    """Return (table, 'insert'|'delete', row-bytes) operations."""
    ops: list[tuple[str, str, bytes]] = []
    for _ in range(reader.u32()):
        table_name = reader.string()
        for _row_group in range(reader.u32()):
            kind = reader.u8()
            if kind == 0:
                inserts = read_row_list(reader)
                deletes = read_row_list(reader)
                ops.append((table_name, "delete", deletes))
                ops.append((table_name, "insert", inserts))
            elif kind == 1:
                ops.append((table_name, "insert", read_row_list(reader)))
            else:
                raise BsatnError(f"unknown table update kind {kind}")
    return ops


def read_transaction_update(reader: Reader) -> list[tuple[str, str, bytes]]:
    ops: list[tuple[str, str, bytes]] = []
    for _ in range(reader.u32()):
        reader.u32()  # query set id
        ops.extend(read_table_updates(reader))
    return ops


def decode_error_bytes(data: bytes) -> str:
    try:
        reader = Reader(data)
        text = reader.string()
        if reader.remaining() == 0:
            return text
    except BsatnError:
        pass
    return data.decode("utf-8", errors="replace")


def parse_server_message(data: bytes) -> list[dict]:
    """Parse one websocket payload, which may contain several v3 messages.

    Server frames start with a compression tag: 0 = none, 1 = brotli, 2 = gzip.
    """
    if not data:
        raise BsatnError("empty server payload")
    if data[0] != 0:
        raise BsatnError(f"unsupported compression tag {data[0]}")
    reader = Reader(data, 1)
    events: list[dict] = []
    if reader.remaining() == 0:
        raise BsatnError("empty server payload")

    while reader.remaining():
        tag = reader.u8()
        if tag == TAG_INITIAL_CONNECTION:
            identity = reader.take(32)
            reader.take(16)
            token = reader.string()
            events.append(
                {
                    "type": "connected",
                    # BSATN stores Identity little-endian; the printed form is big-endian.
                    "identity": identity[::-1].hex(),
                    "token": token,
                }
            )
        elif tag == TAG_SUBSCRIBE_APPLIED:
            reader.u32()
            reader.u32()
            events.append({"type": "snapshot", "tables": read_query_rows(reader)})
        elif tag == TAG_UNSUBSCRIBE_APPLIED:
            reader.u32()
            reader.u32()
            read_option_query_rows(reader)
        elif tag == TAG_SUBSCRIPTION_ERROR:
            if reader.u8() == 0:
                reader.u32()
            reader.u32()
            events.append({"type": "error", "message": reader.string()})
        elif tag == TAG_TRANSACTION_UPDATE:
            events.append({"type": "update", "ops": read_transaction_update(reader)})
        elif tag == TAG_ONE_OFF_QUERY_RESULT:
            reader.u32()
            outcome = reader.u8()
            if outcome == 0:
                read_query_rows(reader)
            elif outcome == 1:
                reader.string()
            else:
                raise BsatnError(f"unknown query result {outcome}")
        elif tag == TAG_REDUCER_RESULT:
            request_id = reader.u32()
            reader.i64()
            outcome = reader.u8()
            if outcome == 0:
                reader.byte_array()
                events.append(
                    {
                        "type": "update",
                        "ops": read_transaction_update(reader),
                        "request_id": request_id,
                    }
                )
            elif outcome == 1:
                events.append({"type": "reducer_ok", "request_id": request_id})
            elif outcome == 2:
                events.append(
                    {
                        "type": "reducer_err",
                        "request_id": request_id,
                        "message": decode_error_bytes(reader.byte_array()),
                    }
                )
            elif outcome == 3:
                events.append(
                    {
                        "type": "reducer_err",
                        "request_id": request_id,
                        "message": reader.string(),
                    }
                )
            else:
                raise BsatnError(f"unknown reducer outcome {outcome}")
        elif tag == TAG_PROCEDURE_RESULT:
            status = reader.u8()
            if status == 0:
                reader.byte_array()
            elif status == 1:
                reader.string()
            else:
                raise BsatnError(f"unknown procedure status {status}")
            reader.i64()
            reader.i64()
            reader.u32()
        elif tag == TAG_SUBSCRIBE_BATCH_APPLIED:
            reader.u32()
            for _ in range(reader.u32()):
                reader.u32()
                outcome = reader.u8()
                if outcome == 0:
                    read_query_rows(reader)
                elif outcome == 1:
                    events.append({"type": "error", "message": reader.string()})
                else:
                    raise BsatnError(f"unknown subscribe batch outcome {outcome}")
        else:
            raise BsatnError(f"unknown server message tag {tag} at offset {reader.i}")
    return events


