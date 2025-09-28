from paddleocr import PaddleOCR
import numpy as np
from PIL import Image
import io
import traceback

class PaddleOCRService:
    def __init__(self):
        print("Initializing OCR service...")
        self.ocr = PaddleOCR(
            device="cpu",
            text_detection_model_name="PP-OCRv5_mobile_det",
            text_recognition_model_name="en_PP-OCRv5_mobile_rec",
            use_doc_orientation_classify=False,
            use_doc_unwarping=False,
            use_textline_orientation=False,
            lang="en",
        )
        print("OCR service initialized")

    def _resize_image(self, image: Image.Image, max_side: int = 1280) -> Image.Image:
        """Resize image if any dimension exceeds max_side."""
        w, h = image.size
        scale = min(max_side / w, max_side / h, 1.0)
        if scale < 1.0:
            new_size = (int(w * scale), int(h * scale))
            print(f"Resizing image from {w}x{h} → {new_size}")
            image = image.resize(new_size, Image.Resampling.LANCZOS)
        return image

    def _parse_results(self, results) -> list[str]:
        """Handle both new (dict) and old (tuple) result formats."""
        text_lines = []

        if not results:
            return text_lines

        for res in results:
            # New pipeline format (>=3.x): list of dicts with "data"
            if isinstance(res, dict) and "data" in res:
                for item in res["data"]:
                    if isinstance(item, dict) and "text" in item:
                        text_lines.append(item["text"])

            # Old style: list of [ [box, (text, conf)], ... ]
            elif isinstance(res, list):
                for line in res:
                    try:
                        if isinstance(line, (list, tuple)) and len(line) > 1:
                            candidate = line[1]
                            if isinstance(candidate, (list, tuple)) and len(candidate) > 0:
                                text_lines.append(candidate[0])  # text string
                    except Exception:
                        continue

            else:
                print("⚠️ Unrecognized result format:", type(res), res)

        return text_lines


    def process_image(self, image_data: bytes) -> list[str]:
        image = Image.open(io.BytesIO(image_data)).convert("RGB")
        # image = self._resize_image(image)
        img_array = np.array(image)

        try:
            results = self.ocr.predict(img_array)
        except Exception as e:
            traceback.print_exc()
            raise e

        text_lines = []
        # results is a list of OCRResult objects
        for res in results:
            if hasattr(res, 'rec_texts'):
                text_lines.extend(res['rec_texts'])  # Use dictionary access
            elif isinstance(res, dict) and 'rec_texts' in res:
                text_lines.extend(res['rec_texts'])  # Also handle pure dict case


        # if text_lines:
        #     print("\n=== OCR Extracted Text ===")
        #     for idx, line in enumerate(text_lines, start=1):
        #         print(f"{idx:02d}. {line}")
        #     print("==========================\n")
        # else:
        #     print("No text detected.")

        return text_lines


