import argparse
import json
from pathlib import Path
import shutil
import tarfile

from download_trace import EXPECTED_SHA256, URL, verify


SELECTED_MEMBERS = {
    "trace-data/cluster_job_log": "cluster_job_log.json",
    "trace-data/cluster_machine_list": "cluster_machine_list.csv",
}


def prepare(archive_path: Path, output: Path) -> None:
    verify(archive_path)
    output.mkdir(parents=True, exist_ok=True)
    found: set[str] = set()
    members: list[dict[str, str | int]] = []
    with tarfile.open(archive_path, "r|gz") as archive:
        for member in archive:
            members.append({"name": member.name, "bytes": member.size})
            if member.name not in SELECTED_MEMBERS:
                continue
            if not member.isfile() or member.name in found:
                raise ValueError(f"Unexpected or duplicate trace member: {member.name}")
            source = archive.extractfile(member)
            if source is None:
                raise ValueError(f"Cannot read {member.name}")
            target = output / SELECTED_MEMBERS[member.name]
            with source, target.open("wb") as destination:
                shutil.copyfileobj(source, destination)
            found.add(member.name)
    if found != set(SELECTED_MEMBERS):
        raise ValueError(f"Missing required archive members: {set(SELECTED_MEMBERS) - found}")
    manifest = {
        "source_url": URL,
        "archive_sha256": EXPECTED_SHA256,
        "license": "CC BY 4.0",
        "archive_members": members,
        "extracted_members": SELECTED_MEMBERS,
        "note": "GPU/CPU/memory telemetry remains in the verified archive; not used by this experiment.",
    }
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(f"Extracted only job log and inventory to {output}; telemetry not expanded.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Safely extract the two required Philly tables.")
    parser.add_argument("--archive", type=Path, default=Path("data") / "philly.tar.gz")
    parser.add_argument("--output", type=Path, default=Path("data") / "philly")
    args = parser.parse_args()
    prepare(args.archive, args.output)
