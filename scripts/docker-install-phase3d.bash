#!/usr/bin/env bash

set -e
set -o pipefail
set -x

export DEBIAN_FRONTEND=noninteractive
apt-get update

lua_ver="$(grep-aptavail -XF Provides lua -s Version -n | sort -Vr | head -n1)"
liblua_name="$(grep-aptavail -eF Package "liblua[0-9.]+-dev" -a -XF Version "${lua_ver}" -s Package -n | head -n1)"

dotnet_name="$(grep-aptavail -eF Package "^dotnet-sdk-[0-9.]+$" -s Package -n | sort -Vr | head -n1)"

packages="

# Q#
${dotnet_name}

# S-Lang
slsh

# SageMath
sagemath

# Scala
scala

# Scheme
mit-scheme

# Scilab
scilab

# Sed
sed

# Sh
posh

# Smalltalk
gnu-smalltalk

# SNOBOL
m4

# SQLite
sqlite

# Squirrel
squirrel3

# Standard ML
rlwrap
smlnj

# Swift
libpython2.7

# Tcl
tcl

# Tcsh
tcsh

# TeX
${liblua_name}
luarocks
texlive-binaries

# Unlambda
unlambda

# Vala
valac

# Verilog
iverilog

# Vimscript
vim

# Visual Basic
mono-vbnc

# Wolfram Language
python3.7

# x86
clang

# XSLT
xsltproc

# YAML
jq

# Yorick
rlwrap
yorick

# Zoem
zoem

# Zot
qt5-qmake
qtscript5-dev

# Zsh
zsh

"

apt-get install -y $(grep -v "^#" <<< "$packages")
rm -rf /var/lib/apt/lists/*

rm "$0"
