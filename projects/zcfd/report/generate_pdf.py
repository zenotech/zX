import sys
import subprocess
import os

PDFSETTINGS_OPTIONS = {
    "/screen": "lowest quality, smallest file",
    "/ebook": "good balance (150 dpi)",
    "/printer": "higher quality (300 dpi)",
    "/prepress": "high quality, color preserving",
    "/default": "almost identical to /screen"
}

def print_help():
    print("Usage: python generate_pdf.py <file.md> <version> [pdf-engine] [pdfsettings]")
    print("  <file.md>      : Markdown file to convert")
    print("  <version>      : Version string")
    print("  [pdf-engine]   : PDF engine (default: pdflatex, options: pdflatex, xelatex)")
    print("  [pdfsettings]  : PDFSETTINGS for Ghostscript compression (default: /ebook)")
    print("\nPDFSETTINGS options for compression:")
    for k, v in PDFSETTINGS_OPTIONS.items():
        print(f"  {k:<10} : {v}")

def main():
    if "--help" in sys.argv or "-h" in sys.argv:
        print_help()
        sys.exit(0)

    if len(sys.argv) < 3:
        print_help()
        sys.exit(1)

    md_file = sys.argv[1]
    version = sys.argv[2]
    pdf_engine = sys.argv[3] if len(sys.argv) > 3 and not sys.argv[3].startswith("/") else "pdflatex"
    pdfsettings = sys.argv[4] if len(sys.argv) > 4 else (sys.argv[3] if len(sys.argv) > 3 and sys.argv[3].startswith("/") else "/ebook")

    pdf_file = f'{md_file.split(".")[-2]}-{version}.pdf'
    pdf_file_compress = f'{md_file.split(".")[-2]}-{version}-compressed.pdf'

    print(f"Generating PDF from {md_file} with version {version}...")
    print(f"Output PDF will be saved as {pdf_file}")
    print("Using report.yaml for metadata...")
    print(f"Using PDF engine: {pdf_engine}")
    print(f"Ghostscript PDFSETTINGS: {pdfsettings}")

    if not os.path.exists("report.yaml"):
        print("Error: report.yaml not found in the current directory.")
        sys.exit(1)
    if not os.path.exists(md_file):
        print(f"Error: Markdown file {md_file} not found.")
        sys.exit(1)

    # Update version in the markdown file
    with open("report.yaml", "r") as f:
        lines = f.readlines()

    with open("report.yaml", "w") as f:
        for line in lines:
            if line.startswith("version:"):
                f.write(f"version: \"{version}\"\n")
            elif line.startswith("header-left:"):
                f.write(f"header-left: \"{version}\"\n")
            else:
                f.write(line)          

    # Build the pandoc docker command
    date = subprocess.getoutput("date \"+%B %e, %Y\"")
    docker_cmd = [
        "docker", "run", "--platform", "linux/amd64", "--rm",
        "-v", "$(pwd):/data",
        "-u", f"{subprocess.getoutput('id -u')}:{subprocess.getoutput('id -g')}",
        "pandoc/extra",
        md_file,]
    
    num_cards = 22
    test_cards = [f"run_{i}/test_card.md" for i in range(1, num_cards + 1)]

    end_args = ["end_document.md", "--metadata-file=report.yaml",
        "-o", pdf_file,
        "--template", "eisvogel",
        "--metadata", f'date="{date}"',
        "--listings",
        f"--pdf-engine={pdf_engine}"
    ]

    docker_cmd.extend(test_cards)
    docker_cmd.extend(end_args)

    # Join the command for shell execution
    docker_cmd_str = " ".join(docker_cmd)
    print(f"Running: {docker_cmd_str}")
    subprocess.run(docker_cmd_str, shell=True, check=True)

    print("Compressing PDF...")
    cmd = f"gs -sDEVICE=pdfwrite -dCompatibilityLevel=1.4 -dPDFSETTINGS={pdfsettings} -dNOPAUSE -dQUIET -dBATCH -sOutputFile={pdf_file_compress} {pdf_file}"
    subprocess.run(cmd, shell=True, check=True)

if __name__ == "__main__":
    main()