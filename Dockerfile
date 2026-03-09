FROM python:3.9-slim

# Install FFmpeg
RUN apt-get update && \
    apt-get install -y ffmpeg && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy requirements first
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application
COPY . .

# Create output directory
RUN mkdir -p output tmp_ffmpeg

# Default command (can be overridden)
CMD ["python", "run_ffmpeg_pipeline.py"]
