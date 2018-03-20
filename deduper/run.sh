#!/bin/bash
source "env/bin/activate" &&
python dedup.py
deactivate
