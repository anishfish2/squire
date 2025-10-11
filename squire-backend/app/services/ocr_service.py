from paddleocr import PaddleOCR
import numpy as np
from PIL import Image
import io
import traceback

class PaddleOCRService:
    def __init__(self):
        self.ocr = None  # Lazy initialization

    def _ensure_ocr_initialized(self):
        """Lazy initialize OCR only when needed"""
        if self.ocr is None:
            try:
                self.ocr = PaddleOCR(
                    device="cpu",
                    text_detection_model_name="PP-OCRv5_mobile_det",
                    text_recognition_model_name="en_PP-OCRv5_mobile_rec",
                    use_doc_orientation_classify=False,
                    use_doc_unwarping=False,
                    use_textline_orientation=False,
                    lang="en",
                )
            except Exception as e:
                print(f"⚠️ Warning: Failed to initialize OCR service: {e}")
                print("OCR functionality will be unavailable, but other features will work.")

    def _resize_image(self, image: Image.Image, max_side: int = 1280) -> Image.Image:
        w, h = image.size
        scale = min(max_side / w, max_side / h, 1.0)
        if scale < 1.0:
            new_size = (int(w * scale), int(h * scale))
            image = image.resize(new_size, Image.Resampling.LANCZOS)
        return image

    def _parse_results(self, results) -> list[str]:
        text_lines = []

        if not results:
            return text_lines

        for res in results:
            if isinstance(res, dict) and "data" in res:
                for item in res["data"]:
                    if isinstance(item, dict) and "text" in item:
                        text_lines.append(item["text"])

            elif isinstance(res, list):
                for line in res:
                    try:
                        if isinstance(line, (list, tuple)) and len(line) > 1:
                            candidate = line[1]
                            if isinstance(candidate, (list, tuple)) and len(candidate) > 0:
                                text_lines.append(candidate[0])
                    except Exception:
                        continue

        return text_lines


    def process_image(self, image_data: bytes) -> list[str]:
        self._ensure_ocr_initialized()  # Initialize OCR if needed

        if self.ocr is None:
            raise RuntimeError("OCR service is not available")

        image = Image.open(io.BytesIO(image_data)).convert("RGB")
        img_array = np.array(image)

        try:
            results = self.ocr.predict(img_array)
        except Exception as e:
            traceback.print_exc()
            raise e

        text_lines = []
        for res in results:
            if hasattr(res, 'rec_texts'):
                text_lines.extend(res['rec_texts'])
            elif isinstance(res, dict) and 'rec_texts' in res:
                text_lines.extend(res['rec_texts'])

        return text_lines


