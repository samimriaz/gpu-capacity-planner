import argparse
import hashlib
from pathlib import Path
import subprocess


URL = "https://media.githubusercontent.com/media/msr-fiddle/philly-traces/master/trace-data.tar.gz"
EXPECTED_SIZE = 1_055_988_361
EXPECTED_SHA256 = "2037ccf63a725a02be718b0e1aeee6142c90b7f62d0d849295120e9f6ba13d2c"


def verify(path: Path) -> None:
    if path.stat().st_size != EXPECTED_SIZE:
        raise ValueError(f"Unexpected archive size: {path.stat().st_size}")
    with path.open("rb") as stream:
        digest = hashlib.file_digest(stream, "sha256").hexdigest()
    if digest != EXPECTED_SHA256:
        raise ValueError(f"Archive checksum mismatch: {digest}")


def download(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        verify(path)
        print(f"Verified existing archive: {path}")
        return
    partial = path.with_suffix(path.suffix + ".part")
    subprocess.run(
        [
            "curl.exe", "--fail", "--location", "--retry", "3",
            "--connect-timeout", "30", "--continue-at", "-",
            "--output", str(partial), URL,
        ],
        check=True,
    )
    verify(partial)
    partial.replace(path)
    print(f"Verified download: {path} ({EXPECTED_SHA256})")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Download and verify the public Philly trace.")
    parser.add_argument("--output", type=Path, default=Path("data") / "philly.tar.gz")
    download(parser.parse_args().output)
