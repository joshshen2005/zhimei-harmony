from __future__ import annotations

import json
from datetime import date, datetime
from pathlib import Path

import openpyxl


ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "数据与要求" / "赛题 1：数据共情者-业务数据.xlsx"
OUTPUT = Path(__file__).resolve().parents[1] / "data.js"


def serialise(value):
    if isinstance(value, (datetime, date)):
        return value.isoformat(sep=" ")
    return value


def sheet_records(sheet):
    rows = sheet.iter_rows(values_only=True)
    headers = [str(value).strip() if value is not None else "" for value in next(rows)]
    result = []
    for excel_row, row in enumerate(rows, start=2):
        record = {"_source_row": excel_row}
        for header, value in zip(headers, row):
            if header:
                record[header] = serialise(value)
        result.append(record)
    return result


def main():
    workbook = openpyxl.load_workbook(SOURCE, read_only=True, data_only=True)
    payload = {
        "meta": {
            "source": SOURCE.name,
            "generated_at": datetime.now().isoformat(timespec="seconds"),
            "notice": "全部数据均为赛事提供的虚构 MOCK DATA，仅用于演示。",
        },
        "messages": sheet_records(workbook["聊天记录"]),
        "orders": sheet_records(workbook["订单"]),
        "tickets": {},
    }

    for name in ["补发换货工单", "线下打款工单", "物流工单", "不良反应工单", "售后退货工单"]:
        payload["tickets"][name] = sheet_records(workbook[name])

    body = "window.ZHIMEI_DATA = " + json.dumps(
        payload,
        ensure_ascii=False,
        separators=(",", ":"),
    ) + ";\n"
    OUTPUT.write_text(body, encoding="utf-8")
    print(f"Wrote {OUTPUT} ({len(body):,} bytes)")


if __name__ == "__main__":
    main()
