#!/usr/bin/env python3
"""
Setup script for WhatsApp Bulk Messenger
"""

from setuptools import setup, find_packages

with open("README.md", "r", encoding="utf-8") as fh:
    long_description = fh.read()

with open("requirements.txt", "r", encoding="utf-8") as fh:
    requirements = [line.strip() for line in fh if line.strip() and not line.startswith("#")]

setup(
    name="whatsapp-bulk-messenger",
    version="1.0.0",
    author="Your Name",
    author_email="your.email@example.com",
    description="A robust, automated WhatsApp bulk messaging tool",
    long_description=long_description,
    long_description_content_type="text/markdown",
    url="https://github.com/yourusername/whatsapp-bulk-messenger",
    packages=find_packages(),
    classifiers=[
        "Development Status :: 4 - Beta",
        "Intended Audience :: Developers",
        "Intended Audience :: End Users/Desktop",
        "License :: OSI Approved :: MIT License",
        "Operating System :: OS Independent",
        "Programming Language :: Python :: 3",
        "Programming Language :: Python :: 3.8",
        "Programming Language :: Python :: 3.9",
        "Programming Language :: Python :: 3.10",
        "Programming Language :: Python :: 3.11",
        "Programming Language :: Python :: 3.12",
        "Programming Language :: Python :: 3.13",
        "Topic :: Communications",
        "Topic :: Internet :: WWW/HTTP :: Browsers",
        "Topic :: Office/Business",
        "Topic :: Software Development :: Libraries :: Python Modules",
    ],
    python_requires=">=3.8",
    install_requires=requirements,
    extras_require={
        "dev": [
            "pytest>=6.0",
            "black>=21.0",
            "flake8>=3.8",
            "mypy>=0.800",
        ],
    },
    entry_points={
        "console_scripts": [
            "whatsapp-bulk=whatsapp_bulk:main",
        ],
    },
    include_package_data=True,
    zip_safe=False,
)
