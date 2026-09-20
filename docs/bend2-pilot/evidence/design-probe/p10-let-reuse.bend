import Base

law main:
  IO(Unit)

def main():
  do IO<Unit>:
    x : U32 = 21
    IO.print(U32.show(U32.add(x, x)))
