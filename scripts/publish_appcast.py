#!/usr/bin/env python3
"""将已上传安装包的固定版本记录合并到最新分支，使用独立 worktree 并有限重试。"""
import argparse
import pathlib
import re
import subprocess
import sys
import tempfile
import time

from release import normalize_version, read_json, upsert_version, write_json_atomic


class PublishError(RuntimeError):
    pass


def run_git(root, arguments, check=True):
    result = subprocess.run(["git", "-C", str(root), *arguments], capture_output=True, text=True)
    if check and result.returncode:
        raise PublishError((result.stderr or result.stdout).strip())
    return result


def load_record(path):
    record = read_json(path)
    if not isinstance(record, dict) or not isinstance(record.get("identifier"), str) or not record["identifier"]:
        raise ValueError("版本记录缺少 identifier")
    entry = record.get("entry")
    if not isinstance(entry, dict):
        raise ValueError("版本记录缺少 entry")
    version = normalize_version(entry.get("version"))
    if version != entry["version"]:
        raise ValueError("entry.version 必须是无 v 前缀的版本号")
    if not isinstance(entry.get("sha256"), str) or not re.fullmatch(r"[0-9a-f]{64}", entry["sha256"]):
        raise ValueError("版本记录缺少合法 sha256")
    if not isinstance(entry.get("url"), str) or not entry["url"].startswith("https://"):
        raise ValueError("版本记录缺少 HTTPS 下载地址")
    return record


def merge_record(path, record):
    appcast = read_json(path) if pathlib.Path(path).exists() else {}
    if not isinstance(appcast, dict):
        raise ValueError("appcast 顶层必须是对象")
    if appcast.get("identifier") not in (None, "", record["identifier"]):
        raise ValueError("appcast 与版本记录 identifier 不一致")
    appcast["identifier"] = record["identifier"]
    appcast["versions"] = upsert_version(appcast.get("versions", []), record["entry"])
    write_json_atomic(path, appcast)


def publish(entry_path, repo_root, branch, max_attempts=3, retry_delay=2):
    record = load_record(entry_path)
    repo_root = pathlib.Path(repo_root).resolve()
    if max_attempts < 1 or retry_delay < 0:
        raise ValueError("重试次数必须为正数，等待时间不能为负数")
    run_git(repo_root, ["check-ref-format", f"refs/heads/{branch}"])
    last_error = ""
    for attempt in range(1, max_attempts + 1):
        # 包和版本记录始终来自 tag；仅元数据基线随远端最新提交变化。
        run_git(repo_root, ["fetch", "origin", f"refs/heads/{branch}:refs/remotes/origin/{branch}"])
        tip = run_git(repo_root, ["rev-parse", "--verify", f"refs/remotes/origin/{branch}^{{commit}}"]).stdout.strip()
        with tempfile.TemporaryDirectory(prefix="bob-appcast-publish-") as directory:
            checkout = pathlib.Path(directory) / "checkout"
            run_git(repo_root, ["worktree", "add", "--detach", str(checkout), tip])
            try:
                merge_record(checkout / "appcast.json", record)
                run_git(checkout, ["add", "--", "appcast.json"])
                diff = run_git(checkout, ["diff", "--cached", "--quiet"], check=False)
                if diff.returncode == 0:
                    print(f"appcast 已包含 v{record['entry']['version']}，无需提交")
                    return False
                if diff.returncode != 1:
                    raise PublishError(diff.stderr.strip())
                run_git(checkout, ["-c", "user.name=github-actions[bot]", "-c", "user.email=41898282+github-actions[bot]@users.noreply.github.com", "commit", "-m", f"chore: publish appcast v{record['entry']['version']}"])
                pushed = run_git(checkout, ["push", "origin", f"HEAD:refs/heads/{branch}"], check=False)
                if pushed.returncode == 0:
                    print(f"已发布 appcast v{record['entry']['version']}（第 {attempt} 次尝试）")
                    return True
                last_error = (pushed.stderr or pushed.stdout).strip()
                print(f"appcast 推送失败（{attempt}/{max_attempts}），将重新获取分支并合并固定记录。", file=sys.stderr)
            finally:
                # 只删除本次创建的临时 checkout；调用目录和用户工作区不会被切换或重置。
                run_git(repo_root, ["worktree", "remove", "--force", str(checkout)])
        if attempt < max_attempts and retry_delay:
            time.sleep(retry_delay)
    raise PublishError(f"appcast 推送在 {max_attempts} 次尝试后仍失败：{last_error}")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--entry-file", type=pathlib.Path, required=True)
    parser.add_argument("--repo-root", type=pathlib.Path, required=True)
    parser.add_argument("--branch", required=True)
    parser.add_argument("--max-attempts", type=int, default=3)
    args = parser.parse_args(argv)
    try:
        publish(args.entry_file, args.repo_root, args.branch, args.max_attempts)
        return 0
    except (OSError, ValueError, PublishError) as error:
        print(f"appcast 发布失败：{error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
