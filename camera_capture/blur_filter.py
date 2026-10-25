"""Resolution-normalized blur score for the 224-pixel SLAM input crop."""
import cv2


def blur_score(image):
    height, width = image.shape[:2]
    scale = 224 / min(height, width)
    small = cv2.resize(image, (round(width * scale), round(height * scale)), interpolation=cv2.INTER_AREA)
    y, x = (small.shape[0] - 224) // 2, (small.shape[1] - 224) // 2
    gray = cv2.cvtColor(small[y:y + 224, x:x + 224], cv2.COLOR_BGR2GRAY)
    return float(cv2.Laplacian(gray, cv2.CV_64F).var())
