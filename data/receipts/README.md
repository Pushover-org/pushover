# Real receipt images: ExpressExpense SRD

Credit: **ExpressExpense.com**, the source of this dataset.

- Page: https://expressexpense.com/blog/free-receipt-images-ocr-machine-learning-dataset/
- Zip: https://expressexpense.com/large-receipt-image-dataset-SRD.zip
  (19.2 MB, md5 `c8eb0f2d286da5ab742e7a5b59f15147`, 200 JPG files)

The images are **not in this repository**. `pnpm receipts:download` fetches the zip, checks the
md5 and unzips it into the git-ignored `.data/receipts/expressexpense/`.

## Licence

The dataset page says (read 2026-11-01): "This dataset is free for use under The MIT License
(MIT). If you use or reference this dataset, please cite our website as the source:
ExpressExpense.com". The zip contains no licence file and the page gives no copyright line, so
none is added here. The MIT License terms:

> Permission is hereby granted, free of charge, to any person obtaining a copy of this software
> and associated documentation files (the "Software"), to deal in the Software without
> restriction, including without limitation the rights to use, copy, modify, merge, publish,
> distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the
> Software is furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all copies or
> substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING
> BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
> NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
> DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
> OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## Duplicates

The set contains copies of the same receipt. `expressexpense-duplicates.json` lists them; only
the `keep` file of a group may enter a corpus.

The restaurants on these receipts are never the defendant of any demo settlement.
