#!/usr/bin/env python3
"""
MIR4 Party Scanner — EasyOCR Backend

Usage:
  python3 party_ocr.py <image_path> [--crop_w RATIO] [--crop_h RATIO] [--columns N]

Takes a screenshot path, extracts player names from the left-side party list
using EasyOCR, and outputs a JSON array of names to stdout.

Requires: pip install easyocr opencv-python-headless numpy
"""

import sys
import json
import argparse
import os

try:
    import cv2
    import numpy as np
    import easyocr
except ImportError as e:
    print(json.dumps({"error": f"Missing Python dependency: {e.name}. Run: pip install easyocr opencv-python-headless numpy"}), file=sys.stderr)
    sys.exit(1)

# ─── Constants tuned for MIR4 party UI ─────────────────────────────
DEFAULT_CROP_W = 0.22   # 22% width from left edge
DEFAULT_CROP_H = 0.88   # 88% height from top
DEFAULT_COLUMNS = 3     # 3 vertical name columns
MIN_NAME_LEN = 3
MAX_NAME_LEN = 18
CONFIDENCE_THRESHOLD = 0.3  # Minimum OCR confidence

# Common UI text to filter out
KNOWN_UI = {
    "party", "clan", "member", "members", "online", "offline",
    "leader", "invite", "kick", "promote", "demote", "leave",
    "follow", "attack", "defend", "retreat", "ready", "cancel",
    "accept", "decline", "close", "settings", "exit", "chat",
    "whisper", "friend", "block", "report", "request", "trade",
    "guild", "alliance", "search", "list", "create", "join",
    "apply", "pending", "invitations", "combat", "power", "level",
    "name", "title", "rank", "exp", "hp", "mp", "atk", "def",
    "option", "menu", "back", "next", "page", "home", "start",
    "loading", "connect", "login", "logout", "select", "enter",
    "auto", "manual", "target", "alert", "notice", "system",
    "confirm", "server", "control", "display", "graphics", "sound",
    "party", "party1", "party2", "party3"
}


def load_image(path):
    """Load image from path, return as numpy RGB array."""
    img = cv2.imread(path)
    if img is None:
        raise ValueError(f"Could not load image: {path}")
    return cv2.cvtColor(img, cv2.COLOR_BGR2RGB)


def preprocess_column(col_img):
    """
    Preprocess a single column image for better OCR:
    - Resize 3x (small MIR4 text)
    - Convert to grayscale
    - Apply adaptive threshold to binarize (handles varying lighting)

    Returns processed image as numpy array (grayscale).
    """
    h, w = col_img.shape[:2]
    
    # Resize 3x for tiny text
    scaled = cv2.resize(col_img, (w * 3, h * 3), interpolation=cv2.INTER_LANCZOS4)
    
    # Convert to grayscale
    gray = cv2.cvtColor(scaled, cv2.COLOR_RGB2GRAY)
    
    # Apply Gaussian blur to reduce noise
    blurred = cv2.GaussianBlur(gray, (3, 3), 0)
    
    # Adaptive threshold — handles varying lighting/background
    # Blocksize 15, C=8 are reasonable for text on game UI
    binary = cv2.adaptiveThreshold(
        blurred, 255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY,
        blockSize=15,
        C=8
    )
    
    return binary


def crop_party_strip(img):
    """Crop the left-side party strip and split into N columns."""
    h, w = img.shape[:2]
    strip_w = max(100, int(w * DEFAULT_CROP_W))
    strip_h = max(100, int(h * DEFAULT_CROP_H))
    col_w = strip_w // DEFAULT_COLUMNS

    strip = img[0:strip_h, 0:strip_w]
    columns = []
    for i in range(DEFAULT_COLUMNS):
        left = i * col_w
        col_img = strip[0:strip_h, left:left + col_w]
        columns.append(col_img)

    return columns, strip


def is_valid_name(text):
    """Check if OCR text looks like a valid MIR4 player name."""
    text = text.strip()
    
    # Length check
    if len(text) < MIN_NAME_LEN or len(text) > MAX_NAME_LEN:
        return False
    
    # Skip purely numeric
    if text.isdigit():
        return False
    
    # Skip known UI text
    if text.lower() in KNOWN_UI:
        return False
    
    # Skip lines with spaces (MIR4 names don't have spaces)
    if " " in text:
        return False
    
    # Skip if only special chars
    cleaned = text.replace("_", "").replace("-", "").replace("[", "").replace("]", "").replace("(", "").replace(")", "").replace("·", "").replace("ツ", "")
    if len(cleaned) == 0:
        return False
    if cleaned.isdigit():
        return False
    
    return True


def clean_name(text):
    """Clean up OCR artifact characters from a name."""
    # Remove leading/trailing special chars (keep · and ツ)
    import re
    text = re.sub(r'^[^a-zA-Z0-9À-ÿ_\-\[\]()·ツ]+', '', text)
    text = re.sub(r'[^a-zA-Z0-9À-ÿ_\-\[\]()·ツ]+$', '', text)
    return text.strip()


def run_ocr_on_columns(columns, reader):
    """
    Run EasyOCR on each column separately.
    Returns a deduplicated list of player names found across all columns.
    """
    all_names = set()
    col_results = []
    
    for idx, col_img in enumerate(columns):
        # Preprocess the column
        processed = preprocess_column(col_img)
        
        # Run EasyOCR
        results = reader.readtext(processed)
        
        col_names = []
        for bbox, text, confidence in results:
            if confidence < CONFIDENCE_THRESHOLD:
                continue
            
            name = clean_name(text)
            if is_valid_name(name):
                col_names.append(name)
                all_names.add(name)
        
        col_results.append(col_names)
    
    return list(all_names), col_results


def main():
    parser = argparse.ArgumentParser(description="MIR4 Party Scanner OCR")
    parser.add_argument("image_path", help="Path to the screenshot image")
    parser.add_argument("--crop_w", type=float, default=DEFAULT_CROP_W)
    parser.add_argument("--crop_h", type=float, default=DEFAULT_CROP_H)
    parser.add_argument("--columns", type=int, default=DEFAULT_COLUMNS)
    parser.add_argument("--debug", action="store_true", help="Include raw OCR results")
    
    args = parser.parse_args()
    
    if not os.path.exists(args.image_path):
        print(json.dumps({"error": f"File not found: {args.image_path}"}))
        sys.exit(1)
    
    try:
        # Initialize EasyOCR reader (lazy loaded, caches model)
        # Use ['en'] for English, can add other languages
        reader = easyocr.Reader(['en'], gpu=False)
        
        # Load and process image
        img = load_image(args.image_path)
        columns, strip = crop_party_strip(img)
        
        # Run OCR
        names, col_details = run_ocr_on_columns(columns, reader)
        
        # Build output
        output = {
            "names": names,
            "count": len(names)
        }
        
        if args.debug:
            output["columns"] = [
                {"index": i, "names": col}
                for i, col in enumerate(col_details)
            ]
        
        print(json.dumps(output, ensure_ascii=False))
        
    except Exception as e:
        print(json.dumps({"error": str(e)}), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
