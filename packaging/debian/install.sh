#!/bin/sh
# Puts FlintNotes on this computer from the package beside this script, and prints the link for the Windows app.
#   ./install.sh                         the service with its own folder for vaults
#   ./install.sh /home/name/obsidian     the same, taking over a folder of notes that already exists (see `flintnotes vault`)
# Run it on the Debian computer itself, in a normal terminal (it asks for sudo).
set -e
here=$(cd "$(dirname "$0")" && pwd)
deb=$(ls "$here"/flintnotes_*_all.deb 2>/dev/null | sort -V | tail -n 1)
[ -n "$deb" ] || { echo "No flintnotes_*_all.deb next to this script." >&2; exit 1; }
if [ "$(id -u)" != 0 ]; then exec sudo "$0" "$@"; fi
[ -z "$1" ] || [ -d "$1" ] || { echo "$1: no such folder." >&2; exit 1; }
# apt installs the package and what it needs (nodejs, tar, adduser); the package starts the service.
apt-get install -y "$deb"
[ -z "$1" ] || flintnotes vault "$1"
systemctl enable --now flintnotes
sleep 2
flintnotes status
echo
flintnotes pair
